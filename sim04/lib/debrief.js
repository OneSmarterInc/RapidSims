'use strict';
// Server only. What the faculty pages need for Results and the class debrief, and the questions
// students answer. Approved Oct 15, 2026. The definitions, departments and lessons reach the faculty
// pages with the faculty session; students receive only the questions.
const LESSON_QUESTIONS = [
  'What did your definition count, and what did it leave out?',
  'If someone challenged your number, what would you show them first?',
  'Who in the company would want retention measured your way?',
  'What would change your number without changing the data?'
];
const REVIEW_QUESTIONS = [
  'Which line of your definition decided your number, and who would want it written that way?',
  'Name a number you are judged by. What is its definition, and what does it leave out?'
];
const LESSONS = [
  { head: 'A number is a definition, a measurement and a purpose.', text: 'The data was the same for every team. The definition and the purpose behind it set the number.' },
  { head: 'Every definition gives a correct number.', text: 'Each one answers its own question. None of them is the retention figure.' },
  { head: 'Ask for the definition before you argue about the number.', text: 'Two careful teams can defend two numbers far apart, and both can be correct.' },
  { head: 'Who writes the definition decides what counts.', text: 'Sales, Finance and Investor Relations each wrote the line that suits their job.' }
];
// Result bands: did the team report the number its own definition gives?
const BANDS = {
  match: { label: 'Matches its sheet', cls: 'g', phrase: 'Reported the number its definition gives' },
  off: { label: 'Off its sheet', cls: 'o', phrase: 'Reported a number its definition does not give' },
  none: { label: 'No number reported', cls: 'l', phrase: 'The clock ran out before a number was locked' }
};
const ORDER = ['match', 'off', 'none'];
module.exports = { LESSON_QUESTIONS, REVIEW_QUESTIONS, LESSONS, BANDS, ORDER };
