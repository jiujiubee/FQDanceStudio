'use strict';
const crypto = require('crypto');

function hash(s, len) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, len || 24);
}
function randomId(prefix) {
  return `${prefix || ''}${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`;
}
/** 易读邀请/绑定码：去除易混淆字符 */
function shortCode(len) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len || 8);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
function safeKey(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

module.exports = {
  userIdFromOpenid: (openid) => `u_${hash(openid)}`,
  attendanceId: (classId, studentId) => `${classId}_${studentId}`,
  classId: (seriesId, date) => `cls_${seriesId}_${date.replace(/-/g, '')}`,
  seriesId: (requestId) => `series_${safeKey(requestId)}`,
  randomId,
  shortCode,
  safeKey,
};
