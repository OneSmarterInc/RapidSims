'use strict';

const BANK = require('../data/phrasings');

const UNMATCHED = { bucket: 'UNMATCHED', cost: 60 };

/**
 * Normalise a typed question for matching.
 * Lowercase, collapse whitespace, strip terminal punctuation, and
 * normalise curly apostrophes so /doesn'?t/ style patterns hold.
 */
// Common typing slips, corrected before matching so a typo is not charged as an unclear question (#87).
const TYPOS = { waht: 'what', wht: 'what', whta: 'what', teh: 'the', hte: 'the', hwo: 'how', yuo: 'you', yoru: 'your', adn: 'and',
  thier: 'their', recieve: 'receive', recieves: 'receives', recieved: 'received', wich: 'which', becuase: 'because', becasue: 'because',
  "waht's": "what's", dose: 'does', doesnt: "doesn't", dont: "don't", whos: "who's", whats: "what's", happend: 'happened', happends: 'happens',
  proces: 'process', procces: 'process', claimes: 'claims', recieving: 'receiving' };
function normalise(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[a-z']+/g, w => TYPOS[w] || w);
}

/**
 * Classify a question into an intent bucket.
 *
 * Returns { bucket, cost, matchedBy } where matchedBy is the source of
 * the winning pattern. matchedBy exists for the instructor transcript
 * view and for taxonomy debugging — it is never shown to a participant.
 *
 * The bank is ordered and first match wins. See data/phrasings.js.
 */
function classify(raw) {
  const text = normalise(raw);
  if (!text) return { ...UNMATCHED, matchedBy: null };

  for (const entry of BANK) {
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        return {
          bucket: entry.bucket,
          cost: entry.cost,
          matchedBy: pattern.source
        };
      }
    }
  }

  return { ...UNMATCHED, matchedBy: null };
}

module.exports = { classify, normalise };
