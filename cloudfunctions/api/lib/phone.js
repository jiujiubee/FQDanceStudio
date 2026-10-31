'use strict';
/**
 * 手机号校验与验证。
 * - 仅支持中国大陆手机号（11 位，1[3-9] 开头）。
 * - 「已验证」只能来自两种途径：微信官方手机号快速验证（getPhoneNumber 动态令牌，由服务端换取）
 *   或短信验证码。手工录入的号码一律为「未验证」。
 * - 唯一性：phoneIndex 集合以 `ph_<手机号>` 为主键，在事务中创建，保证同一号码只能关联一个学员档案。
 * - 个人信息保护：验证码只保存加盐哈希，5 分钟有效，最多尝试 5 次；号码仅用于身份核验与联系。
 */
const crypto = require('crypto');
const time = require('./time');
const { E } = require('./errors');

const PHONE_RE = /^1[3-9]\d{9}$/;
const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const DUP_MESSAGE = '该手机号已被注册，如需帮助请联系管理员';

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

function hashCode(userId, phone, code) {
  return crypto.createHash('sha256').update(`${userId}|${phone}|${code}`).digest('hex');
}

/** 发送短信验证码。providers.sendSms 未配置时拒绝（开发环境返回 devCode 便于联调） */
async function sendSmsCode(ctx, rawPhone, providers) {
  const phone = validate(rawPhone);
  const id = `pv_${ctx.userId}`;
  const prev = await ctx.store.get('phoneVerifications', id);
  const nowMs = time.now();
  if (prev && prev.sentAt && nowMs - prev.sentAt < RESEND_MS) throw E.rule('TOO_FREQUENT', '发送过于频繁，请稍后再试');
  const sender = providers && providers.sendSms;
  if (!sender && !ctx.devMode) throw E.rule('SMS_UNAVAILABLE', '短信验证暂未开通，请使用微信手机号快捷验证或联系管理员');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const doc = { phone, codeHash: hashCode(ctx.userId, phone, code), expiresAt: nowMs + CODE_TTL_MS, attempts: 0, sentAt: nowMs };
  if (prev) await ctx.store.set('phoneVerifications', id, doc);
  else await ctx.store.create('phoneVerifications', { _id: id, ...doc });
  if (sender) {
    await sender(phone, code);
    return { sent: true };
  }
  return { sent: true, devCode: code };
}

/** 校验短信验证码，成功后删除验证记录（一次性） */
async function checkSmsCode(ctx, phone, code) {
  if (!/^\d{6}$/.test(String(code || ''))) throw E.invalid('请输入6位短信验证码');
  const id = `pv_${ctx.userId}`;
  const rec = await ctx.store.get('phoneVerifications', id);
  if (!rec || rec.phone !== phone) throw E.rule('SMS_CODE_INVALID', '请先获取短信验证码');
  if (time.now() > rec.expiresAt) throw E.rule('SMS_CODE_EXPIRED', '验证码已过期，请重新获取');
  if (rec.attempts >= MAX_ATTEMPTS) throw E.rule('SMS_CODE_LOCKED', '验证码错误次数过多，请重新获取');
  if (rec.codeHash !== hashCode(ctx.userId, phone, String(code))) {
    await ctx.store.update('phoneVerifications', id, { attempts: rec.attempts + 1 });
    throw E.rule('SMS_CODE_INVALID', '验证码错误');
  }
  await ctx.store.remove('phoneVerifications', id);
}

/**
 * 解析注册时提交的手机号凭证，返回 { phone, method }。
 * - phoneCode：微信 getPhoneNumber 返回的动态令牌（优先）
 * - phone + smsCode：短信验证码
 * 未提供任何验证凭证时拒绝（手工输入不视为已验证）。
 */
async function verify(ctx, data, providers) {
  if (data.phoneCode) {
    const resolver = providers && providers.resolveWxPhone;
    if (!resolver) throw E.rule('WX_PHONE_UNAVAILABLE', '微信手机号验证暂不可用，请使用短信验证');
    let info;
    try {
      info = await resolver(String(data.phoneCode));
    } catch (e) {
      throw E.rule('WX_PHONE_FAILED', '微信手机号验证失败，请重试或使用短信验证');
    }
    if (!info || (info.countryCode && String(info.countryCode) !== '86')) throw E.invalid('仅支持中国大陆手机号');
    return { phone: validate(info.purePhoneNumber || info.phoneNumber), method: 'wechat' };
  }
  const phone = validate(data.phone);
  if (!data.smsCode) throw E.rule('PHONE_NOT_VERIFIED', '请完成手机号验证');
  await checkSmsCode(ctx, phone, data.smsCode);
  return { phone, method: 'sms' };
}

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

module.exports = { PHONE_RE, DUP_MESSAGE, normalize, validate, indexId, sendSmsCode, verify, claim, release };
