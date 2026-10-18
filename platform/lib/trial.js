'use strict';
// Trial accounts (Oct 18, Plan C). An administrator invites a facilitator as a full
// account or a trial. A trial has every published simulation: classes, Rehearse,
// Play it yourself, one-pagers, Getting started and Ask Claude. Students join and
// sessions with students start once the account is full. When a trial ends, the
// faculty pages show one message and nothing is deleted.
const DAY = 86400000;
const DEFAULT_DAYS = 10;
const EXTEND_DAYS = 7;

const JOIN_CLOSED = "This class opens to students once your instructor's account is confirmed.";
const CLASS_NOTE = 'Students can join once your account moves from trial to full. Until then, Rehearse and Play it yourself are open to you.';
const SESSION_TITLE = 'Sessions open on a full account';
const SESSION_MESSAGE = 'Your trial covers Rehearse and Play it yourself. Sessions with students open when your account is full.';
const ENDED_TITLE = 'Your trial has ended';

const longDate = d => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const endedMessage = endsAt => `Your trial ended on ${longDate(endsAt)}. To keep going, write to support@flexee.org and we'll move your account to full.`;

// What kind of account this is, and where its trial stands. Admins and students are never on trial.
function trialOf(user, now = Date.now()) {
  if (!user || user.role !== 'faculty' || user.account_kind !== 'trial') {
    return { kind: 'full', trial: false, ended: false, endsAt: null, daysLeft: null };
  }
  const ends = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
  const ended = !!ends && ends.getTime() <= now;
  return { kind: 'trial', trial: true, ended, endsAt: ends ? ends.toISOString() : null,
    daysLeft: ends ? Math.max(0, Math.ceil((ends.getTime() - now) / DAY)) : null,
    message: ended ? endedMessage(ends) : null };
}

// Whole days, 1 to 365; anything else falls back to the default given.
function days(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 && n <= 365 ? n : null;
}

// A trial account opens a session page only for its own practice session (Rehearse's
// "See the faculty view"). The platform asks the sim for that faculty member's practice
// session in this class and compares the code.
async function practiceSessionMatches({ me, course, sim, session, practiceStatus }) {
  if (!session || !course || !sim || typeof practiceStatus !== 'function') return false;
  try {
    const r = await practiceStatus(me, course, sim);
    return !!(r && r.status === 200 && r.data && r.data.code && String(r.data.code).toUpperCase() === session);
  } catch { return false; }
}

module.exports = { DAY, DEFAULT_DAYS, EXTEND_DAYS, JOIN_CLOSED, CLASS_NOTE, SESSION_TITLE, SESSION_MESSAGE, ENDED_TITLE,
  longDate, endedMessage, trialOf, days, practiceSessionMatches };
