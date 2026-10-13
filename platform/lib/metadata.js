'use strict';
function jsonDetail(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Metadata must be an object'), { status: 400 });
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > 12000) throw Object.assign(new Error('Catalogue metadata exceeds 12000 bytes'), { status: 413 });
  return text;
}
function launchUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw Object.assign(new Error('Invalid simulation address'), { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || url.href.length > 500) {
    throw Object.assign(new Error('Use an HTTP(S) simulation address without credentials, query or fragment'), { status: 400 });
  }
  return url.href.replace(/\/+$/, '');
}
module.exports = { jsonDetail, launchUrl };
