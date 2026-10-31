'use strict';
/**
 * 时间工具：中国大陆统一使用 Asia/Shanghai（UTC+8，无夏令时）。
 * 存储：时间戳为 UTC 毫秒；业务日期为上海时区 YYYY-MM-DD；时间为 HH:mm。
 */
const OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const WEEKDAY_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

let clock = () => Date.now();

function now() {
  return clock();
}
/** 仅供测试注入时钟 */
function setClock(fn) {
  clock = fn || (() => Date.now());
}

const pad = (n) => String(n).padStart(2, '0');

function toDate(ms) {
  const d = new Date(ms + OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function toTime(ms) {
  const d = new Date(ms + OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function today() {
  return toDate(now());
}
function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
/** 上海本地日期+时间 → UTC 毫秒 */
function toMs(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - OFFSET_MS;
}
function addDays(date, n) {
  return toDate(toMs(date, '00:00') + n * DAY_MS);
}
function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
}
/**
 * 自然月有效期的最后一天（含当天）：start + n 个自然月 - 1 天。
 * 目标月不存在对应日期（如 1-31 + 1 个月）时，视为下月 1 日起算，即到期日为目标月最后一天。
 * 例：2026-11-15 + 3 个月 → 2027-02-14；2024-01-31 + 1 个月 → 2024-02-29。
 */
function periodEnd(start, n) {
  const [y, m, d] = start.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  if (d > lastDay) return `${ty}-${pad(tm + 1)}-${pad(lastDay)}`;
  return addDays(`${ty}-${pad(tm + 1)}-${pad(d)}`, -1);
}
/** 1=周一 … 7=周日 */
function weekday(date) {
  const w = new Date(toMs(date, '12:00')).getUTCDay();
  return w === 0 ? 7 : w;
}
function weekStart(date) {
  return addDays(date, 1 - weekday(date));
}
function monthKey(date) {
  return date.slice(0, 7);
}
function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return { time: `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`, overflow: total >= 24 * 60 };
}
function diffDays(a, b) {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

module.exports = {
  OFFSET_MS, DAY_MS, WEEKDAY_CN,
  now, setClock, toDate, toTime, today, isDate, isTime, toMs,
  addDays, addMonths, periodEnd, weekday, weekStart, monthKey, addMinutes, diffDays,
};
