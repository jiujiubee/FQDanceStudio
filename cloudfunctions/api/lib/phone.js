'use strict';
/**
 * 手机号（学员资料中的选填项）格式校验与唯一性。
 * - 仅支持中国大陆手机号（11 位，1[3-9] 开头）。
 * - 由学员或店主手动填写，不做短信或微信验证，也不参与注册/登录（身份只来自 OpenID）。
 * - 唯一性：phoneIndex 集合以 `ph_<手机号>` 为主键，在事务中创建，保证同一号码只能关联一个学员档案。
 */
const time = require('./time');
const { E } = require('./errors');

const PHONE_RE = /^1[3-9]\d{9}$/;
const DUP_MESSAGE = '该手机号已被注册，如需帮助请联系店主';

function normalize(raw) {
  if (raw === undefined || raw === null) return '';
  return String(raw).replace(/[\s-]/g, '').replace(/^(\+?86)(?=1\d{10}$)/, '');
}

function validate(raw, opts) {
  const p = normalize(raw);
  if (!p) {
    if (opts && opts.optional) return '';
    throw E.invalid('请填写手机号');
  }
  if (!PHONE_RE.test(p)) throw E.invalid('请输入正确的中国大陆手机号');
  return p;
}

const indexId = (phone) => `ph_${phone}`;

/** 事务内：占用手机号；已被其他档案占用则抛出重复错误 */
async function claim(tx, phone, studentId) {
  const cur = await tx.get('phoneIndex', indexId(phone));
  if (cur && cur.studentId !== studentId) throw E.conflict('PHONE_EXISTS', DUP_MESSAGE);
  if (!cur) await tx.create('phoneIndex', { _id: indexId(phone), studentId, createdAt: time.now() });
}

async function release(tx, phone, studentId) {
  if (!phone) return;
  const cur = await tx.get('phoneIndex', indexId(phone));
  if (cur && cur.studentId === studentId) await tx.remove('phoneIndex', indexId(phone));
}

module.exports = { PHONE_RE, DUP_MESSAGE, normalize, validate, indexId, claim, release };
