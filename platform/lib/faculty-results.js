'use strict';
// Read-only, course-scoped result histories. Never infer attempt identity from a name,
// timestamp, or identical payload: repeat submissions and callback retries can coexist.
const PAGE_SIZE = 20, PREVIEW_SIZE = 3, HISTORY_SIZE = 10, SESSION_ROWS = 600, SESSION_LIMIT = 20;
const error = (status, message) => Object.assign(new Error(message), {status});
// Works with Neon tagged SQL and the laptop's pg-backed tagged adapter.
function query(s, text, values) {
  const pieces = text.split(/\$(\d+)/g), strings = [pieces[0]], args = [];
  for (let i=1;i<pieces.length;i+=2) { args.push(values[Number(pieces[i])-1]); strings.push(pieces[i+1]); }
  strings.raw = [...strings]; return s(strings, ...args);
}
const scope = `WITH roster AS (
 SELECT u.id AS student_id, u.name, u.email, e.paid, e.dropped
 FROM enrolments e JOIN users u ON u.id=e.student_id WHERE e.course_id=$1
), launch_scope AS (
 SELECT l.user_id, count(*) FILTER (WHERE l.course_id=$1)::int AS starts,
   (count(DISTINCT l.course_id)=1 AND bool_and(l.course_id IS NOT NULL) AND min(l.course_id)=$1) AS legacy_allowed
 FROM launches l JOIN roster r ON r.student_id=l.user_id
 WHERE l.sim_id=$2 AND l.as_role='student' GROUP BY l.user_id
), bound_completions AS (
 SELECT c.*, (c.course_id IS NULL) AS legacy_course
 FROM completions c JOIN roster r ON r.student_id=c.user_id
 LEFT JOIN launch_scope l ON l.user_id=c.user_id
 WHERE c.sim_id=$2 AND (c.course_id=$1 OR (c.course_id IS NULL AND l.legacy_allowed))
), bound_transcripts AS (
 SELECT t.*, (t.course_id IS NULL) AS legacy_course
 FROM transcripts t JOIN roster r ON r.student_id=t.user_id
 LEFT JOIN launch_scope l ON l.user_id=t.user_id
 WHERE t.sim_id=$2 AND (t.course_id=$1 OR (t.course_id IS NULL AND l.legacy_allowed))
)`;
const statuses = new Set(['all','completed','started','not-started','not-released','repeated','removed']);
async function results(s, course, sim, input) {
  const filter = statuses.has(input.filter) ? input.filter : 'all';
  const sort = input.sort === 'attempts' ? 'attempts' : 'name';
  const search = String(input.search || '').trim().slice(0,200);
  const page = Math.min(100000, Math.max(1, Math.floor(Number(input.page)||1)));
  const [data] = await query(s, `${scope}, students AS (
 SELECT r.*, coalesce(l.starts,0) AS starts,
   (SELECT count(*)::int FROM bound_completions c WHERE c.user_id=r.student_id) AS completions,
   (SELECT count(*)::int FROM bound_transcripts t WHERE t.user_id=r.student_id) AS transcript_count
 FROM roster r LEFT JOIN launch_scope l ON l.user_id=r.student_id
), classified AS (
 SELECT *, CASE WHEN dropped THEN 'removed' WHEN completions>0 THEN 'completed'
   WHEN starts>0 THEN 'started' WHEN NOT paid THEN 'not-released' ELSE 'not-started' END AS status FROM students
), filtered AS (
 SELECT * FROM classified WHERE ($3='all' OR status=$3 OR ($3='repeated' AND completions>1))
 AND ($4='' OR strpos(lower(name || ' ' || email),lower($4))>0)
), totals AS (
 SELECT count(*)::int AS total, greatest(1,ceil(count(*)::numeric/$6)::int) AS pages FROM filtered
), paged AS (
 SELECT f.* FROM filtered f ORDER BY
 CASE WHEN $5='attempts' THEN completions END DESC, lower(name), student_id
 LIMIT $6 OFFSET ((least($7,(SELECT pages FROM totals))-1)*$6)
)
SELECT (SELECT total FROM totals) AS total, (SELECT pages FROM totals) AS pages,
 least($7,(SELECT pages FROM totals)) AS page,
 json_build_object('students',count(*) FILTER (WHERE NOT dropped),
 'completed',count(*) FILTER (WHERE NOT dropped AND completions>0),
 'completions',coalesce(sum(completions) FILTER (WHERE NOT dropped),0),
 'repeated',count(*) FILTER (WHERE NOT dropped AND completions>1)) AS stats,
 EXISTS(SELECT 1 FROM completions c JOIN roster r ON r.student_id=c.user_id
   LEFT JOIN launch_scope l ON l.user_id=c.user_id WHERE c.sim_id=$2 AND c.course_id IS NULL
   AND NOT coalesce(l.legacy_allowed,false))
 OR EXISTS(SELECT 1 FROM transcripts t JOIN roster r ON r.student_id=t.user_id
   LEFT JOIN launch_scope l ON l.user_id=t.user_id WHERE t.sim_id=$2 AND t.course_id IS NULL
   AND NOT coalesce(l.legacy_allowed,false)) AS ambiguous_legacy,
 coalesce((SELECT json_agg(row_to_json(p)) FROM (
 SELECT pg.*, coalesce((SELECT json_agg(row_to_json(a)) FROM (
   SELECT c.id,c.completed_at,c.duration_seconds,c.summary,c.metrics,c.legacy_course,
     row_number() OVER (ORDER BY c.completed_at,c.id)::int AS ordinal
   FROM bound_completions c WHERE c.user_id=pg.student_id
   ORDER BY c.completed_at DESC,c.id DESC LIMIT ${PREVIEW_SIZE}
 ) a),'[]'::json) AS attempts FROM paged pg
 ORDER BY CASE WHEN $5='attempts' THEN pg.completions END DESC,lower(pg.name),pg.student_id
 ) p),'[]'::json) AS rows FROM students`, [course.id,sim.id,filter,search,sort,PAGE_SIZE,page]);
  const sessionRows = await query(s, `SELECT c.id, c.user_id, c.completed_at::text AS completed_at, c.summary, u.name
    FROM completions c JOIN enrolments e ON e.student_id=c.user_id AND e.course_id=$1
    JOIN users u ON u.id=c.user_id
    WHERE c.course_id=$1 AND c.sim_id=$2 AND c.summary LIKE '%"sessionCode"%'
    ORDER BY c.completed_at DESC, c.id DESC LIMIT ${SESSION_ROWS}`, [course.id, sim.id]);
  return {...data, sessions: groupSessions(sessionRows), course:{id:course.id,title:course.title},sim,filter,sort,search,pageSize:PAGE_SIZE};
}
// Completions that name a class session are grouped by session, then by team.
// Each saved row is one member; the row carries that member's own review.
function groupSessions(rows) {
  const sessions = new Map();
  for (const row of rows || []) {
    let v; try { v = typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary; } catch { continue; }
    if (!v || typeof v !== 'object' || typeof v.sessionCode !== 'string' || !v.sessionCode) continue;
    const code = v.sessionCode.slice(0, 20);
    if (!sessions.has(code)) {
      if (sessions.size >= SESSION_LIMIT) continue;
      sessions.set(code, { code, name: v.sessionName || null, createdAt: v.sessionCreatedAt || null, latestAt: row.completed_at, teams: new Map() });
    }
    const sess = sessions.get(code);
    const teamKey = v.teamRunId || `individual:${row.user_id}`;
    if (!sess.teams.has(teamKey)) {
      sess.teams.set(teamKey, {
        key: teamKey, label: v.teamRunId ? (v.teamLabel || v.teamRunId) : row.name,
        team: !!v.teamRunId, completedBy: v.completedBy || null,
        roster: Array.isArray(v.teamMembers) ? v.teamMembers.slice(0, 30) : null,
        overall: v.result?.overall || null, year3: v.result?.year3?.title || null, year3Band: v.year3Band || v.result?.year3?.band || null,
        members: []
      });
    }
    const team = sess.teams.get(teamKey);
    if (team.members.some(m => m.userId === row.user_id)) continue;
    team.members.push({ userId: row.user_id, name: row.name, completedAt: row.completed_at,
      reflection1: v.reflection1 || '', reflection2: v.reflection2 || '' });
  }
  return [...sessions.values()].map(sess => ({ ...sess,
    teams: [...sess.teams.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }))
  }));
}
async function history(s, course, sim, input) {
  const studentId = String(input.studentId || '').slice(0,200);
  const student = (await s`SELECT u.id, u.name, u.email FROM enrolments e JOIN users u ON u.id=e.student_id
    WHERE e.course_id=${course.id} AND e.student_id=${studentId}`)[0];
  if (!student) throw error(404,'no_such_student');
  const kind = input.kind === 'transcripts' ? 'transcripts' : input.kind === 'attempts' ? 'attempts' : null;
  if (!kind) throw error(400,'invalid_history_kind');
  let date=null,id=null;
  if (input.cursor) {
    try {
      const c=JSON.parse(Buffer.from(String(input.cursor).slice(0,1000),'base64url').toString());
      if (typeof c.id!=='string' || !c.id || c.id.length>200 || typeof c.at!=='string' || !Number.isFinite(Date.parse(c.at))) throw Error();
      date=c.at;id=c.id; // Keep PostgreSQL microseconds; Date.toISOString would drop them.
    } catch {throw error(400,'invalid_cursor');}
  }
  const table=kind==='attempts'?'bound_completions':'bound_transcripts';
  const time=kind==='attempts'?'completed_at':'recorded_at';
  const columns=kind==='attempts'?'id,completed_at,duration_seconds,summary,metrics,legacy_course':'id,recorded_at,sim_version,envelope,legacy_course';
  const rows=await query(s,`${scope}, ordered AS (
    SELECT ${columns},row_number() OVER (ORDER BY ${time},id)::int AS ordinal FROM ${table} WHERE user_id=$3
  ) SELECT ${columns.replace(time,time+'::text AS '+time)}, ordinal FROM ordered WHERE ($4::timestamptz IS NULL OR (${time},id)<($4::timestamptz,$5::text))
  ORDER BY ${time} DESC,id DESC LIMIT ${HISTORY_SIZE+1}`,[course.id,sim.id,studentId,date,id]);
  const more=rows.length>HISTORY_SIZE, items=rows.slice(0,HISTORY_SIZE), last=items[items.length-1];
  return {student,kind,items,next:more?Buffer.from(JSON.stringify({at:last[time],id:last.id})).toString('base64url'):null};
}
module.exports={results,history,groupSessions};
