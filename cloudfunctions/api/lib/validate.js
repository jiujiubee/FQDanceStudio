'use strict';
const { E } = require('./errors');
const time = require('./time');

const v = {
  str(val, name, opts) {
    opts = opts || {};
    if (val === undefined || val === null || val === '') {
      if (opts.optional) return opts.default !== undefined ? opts.default : '';
      throw E.invalid(`${name}不能为空`);
    }
    if (typeof val !== 'string') throw E.invalid(`${name}格式错误`);
    const s = val.trim();
    if (!s && !opts.optional) throw E.invalid(`${name}不能为空`);
    if (s.length > (opts.max || 100)) throw E.invalid(`${name}过长`);
    if (opts.pattern && s && !opts.pattern.test(s)) throw E.invalid(`${name}格式错误`);
    return s;
  },
  int(val, name, opts) {
    opts = opts || {};
    if ((val === undefined || val === null || val === '') && opts.optional) return opts.default;
    const n = Number(val);
    if (!Number.isInteger(n)) throw E.invalid(`${name}必须为整数`);
    if (opts.min !== undefined && n < opts.min) throw E.invalid(`${name}不能小于${opts.min}`);
    if (opts.max !== undefined && n > opts.max) throw E.invalid(`${name}不能大于${opts.max}`);
    return n;
  },
  date(val, name, opts) {
    if ((val === undefined || val === null || val === '') && opts && opts.optional) return '';
    if (!time.isDate(val)) throw E.invalid(`${name}日期格式错误`);
    return val;
  },
  time(val, name) {
    if (!time.isTime(val)) throw E.invalid(`${name}时间格式错误`);
    return val;
  },
  oneOf(val, name, list, opts) {
    if ((val === undefined || val === null) && opts && opts.optional) return opts.default;
    if (!list.includes(val)) throw E.invalid(`${name}取值错误`);
    return val;
  },
  id(val, name) {
    if (typeof val !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(val)) throw E.invalid(`${name}无效`);
    return val;
  },
  ids(val, name, max) {
    if (!Array.isArray(val)) throw E.invalid(`${name}格式错误`);
    if (val.length > (max || 500)) throw E.invalid(`${name}数量过多`);
    return [...new Set(val.map((x) => v.id(x, name)))];
  },
};

/** 正则特殊字符转义，防止 ReDoS / 注入 */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { v, escapeRegex };
