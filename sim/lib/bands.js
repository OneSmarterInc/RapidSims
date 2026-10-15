// Disaster or Breach result bands, from two facts about each student's three locked positions:
// did they make a move they could not undo before Day 3, and did their Day 3 reading name both causes?
// Shared by the server (completions) and the faculty pages (Results, debrief). Approved Oct 15, 2026.
(function (global) {
'use strict';
const IRREVERSIBLE = { restore_now: true, restore_clean: true, notify: true };
const ACTION_LABEL = {
  restore_now: 'Restore 4-hour incremental', restore_clean: 'Restore 19-hour backup', image_first: 'Image, then restore',
  isolate: 'Isolate and hold', hunt: 'Security hunt', notify: 'Notify clients'
};
const READING_LABEL = { hardware: 'Hardware', breach: 'Intrusion', both: 'Both', unknown: 'Undetermined' };
const BANDS = {
  ready_both: { label: 'Ready for both', cls: 'g', phrase: 'Named both causes, with the evidence still intact' },
  held: { label: 'Held, undecided', cls: 'y', phrase: 'Kept the evidence, but never named the cause' },
  late: { label: 'Right, too late', cls: 'o', phrase: 'Named both causes after the evidence was gone' },
  gone: { label: 'Evidence gone', cls: 'l', phrase: 'Acted early and settled on one cause' }
};
const ORDER = ['ready_both', 'held', 'late', 'gone'];
const actedEarly = positions => (positions || []).slice(0, 2).some(p => p && IRREVERSIBLE[p.action]);
function bandOf(positions) {
  if (!Array.isArray(positions) || positions.length < 3 || !positions[2]) return null;
  const early = actedEarly(positions), both = positions[2].reading === 'both';
  return early ? (both ? 'late' : 'gone') : (both ? 'ready_both' : 'held');
}
const api = { IRREVERSIBLE, ACTION_LABEL, READING_LABEL, BANDS, ORDER, actedEarly, bandOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.DisasterBands = api;
})(typeof window !== 'undefined' ? window : globalThis);
