// Simulations that support account-bound class invitations and faculty rooms.
// Keep course lookup, launch authorization and roster access in agreement.
const SESSION_SIMS = new Set([
  'rapid-01-disaster',
  'rapid-03-midland',
  'rapid-04-whose-number',
  'rapid-05-approve',
  'rapid-06-switch',
  'rapid-07-bought',
  'rapid-08-later',
  'rapid-09-money-land',
  'rapid-10-bubble',
  'rapidsimplus-02'
]);

function sessionSupported(sim) {
  return typeof sim?.detail?._sessionSupported === 'boolean'
    ? sim.detail._sessionSupported : SESSION_SIMS.has(sim?.id);
}
async function supportsSessions(s, id) {
  const sim = (await s`SELECT id, detail FROM sims WHERE id = ${id}`)[0];
  return sessionSupported(sim);
}
module.exports = { SESSION_SIMS, sessionSupported, supportsSessions };

