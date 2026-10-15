// What Did It Tell Them? result bands, from two facts about each student's run:
// did they keep the index before the nightly rebuild (preserve at Hour 1 or Hour 7, by action
// or in conversation, with no re-index before it), and did their Day 2 reading name both causes?
// Server only: the faculty pages receive these with the faculty session. Approved Oct 15, 2026.
'use strict';
const IRREVERSIBLE = { reindex: true, rollback: true, notify: true };
const ACTION_LABEL = {
  preserve: 'Preserve the index', halt: 'Halt Relay for CS-7400', pull_log: 'Pull the 90-day log',
  reindex: 'Re-index the library', rollback: 'Roll back the threshold', notify: 'Notify customers'
};
const READING_LABEL = { content: 'Stale document', supervision: 'Not escalated', both: 'Both', unknown: 'Undetermined' };
const BANDS = {
  ready_both: { label: 'Ready for both', cls: 'g', phrase: 'Kept the index and named both causes' },
  held: { label: 'Held, undecided', cls: 'y', phrase: 'Kept the index, but never named both causes' },
  late: { label: "Right, can't answer", cls: 'o', phrase: 'Named both causes after the index was gone' },
  gone: { label: 'Index lost', cls: 'l', phrase: 'Lost the index and settled on one cause' }
};
const ORDER = ['ready_both', 'held', 'late', 'gone'];
const at = v => (v === null || v === undefined || v === '' ? null : Number(v));
function indexKept(positions, preservedAt) {
  const p = at(preservedAt);
  if (p === null || !(p === 0 || p === 1)) return false;
  return !(positions || []).slice(0, p).some(x => x && x.action === 'reindex');
}
const actedEarly = positions => (positions || []).slice(0, 2).some(p => p && IRREVERSIBLE[p.action]);
function bandOf(positions, preservedAt) {
  if (!Array.isArray(positions) || positions.length < 3 || !positions[2]) return null;
  const kept = indexKept(positions, preservedAt), both = positions[2].reading === 'both';
  return kept ? (both ? 'ready_both' : 'held') : (both ? 'late' : 'gone');
}
module.exports = { IRREVERSIBLE, ACTION_LABEL, READING_LABEL, BANDS, ORDER, indexKept, actedEarly, bandOf };
