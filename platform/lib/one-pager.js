'use strict';
// A sim's faculty one-pager: its own ONE-PAGER.md (via the catalogue snapshot), or an Admin edit of it.
// An Admin edit holds until the sim's next release (a new catalogue revision), when the sim's own page returns.
const source = require('./catalogue-source.json');
function onePagerFor(id, detail) {
  const own = Object.hasOwn(source, id) && source[id].onePager ? source[id].onePager : null;
  const edit = detail && detail.onePagerOverride;
  if (own && edit && edit.text && edit.revision === own.reviewedFor) return { text: edit.text, reviewedFor: own.reviewedFor, edited: true, own: own.text };
  return own ? { text: own.text, reviewedFor: own.reviewedFor, edited: false, own: own.text } : null;
}
// What Admin saves: nothing when the text matches the sim's own page (or is empty), else the edit for this release.
function overrideFrom(id, text, now) {
  const own = Object.hasOwn(source, id) && source[id].onePager ? source[id].onePager : null;
  const clean = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim().slice(0, 20000);
  if (!own || !clean || clean === own.text) return null;
  return { text: clean, revision: own.reviewedFor, at: now };
}
// A sim's student one-pager: its own STUDENT-ONE-PAGER.md. Students read it on their course page before they start.
function studentPageFor(id) {
  const own = Object.hasOwn(source, id) && source[id].studentOnePager ? source[id].studentOnePager : null;
  return own ? { text: own.text, reviewedFor: own.reviewedFor } : null;
}
module.exports = { onePagerFor, overrideFrom, studentPageFor };
