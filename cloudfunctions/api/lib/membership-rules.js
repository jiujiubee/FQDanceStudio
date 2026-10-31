'use strict';
/**
 * 会员卡核心规则（纯函数 + 事务内操作），被签到、手动签到、取消课程、管理端调整共用。
 */
const time = require('./time');
const { E } = require('./errors');

const TYPES = Object.freeze({ CLASS_PASS: 'CLASS_PASS', MONTHLY: 'MONTHLY', QUARTERLY: 'QUARTERLY' });
const TYPE_LIST = [TYPES.CLASS_PASS, TYPES.MONTHLY, TYPES.QUARTERLY];
const TYPE_LABEL = { CLASS_PASS: '次卡', MONTHLY: '月卡', QUARTERLY: '季卡' };
/** 各期限卡默认自然月数 */
const PERIOD_MONTHS = { MONTHLY: 1, QUARTERLY: 3 };
const LEGACY_TYPE = { pass: TYPES.CLASS_PASS, monthly: TYPES.MONTHLY };

/** 兼容旧数据：pass → CLASS_PASS，monthly → MONTHLY */
function canonType(t) {
  return LEGACY_TYPE[t] || t;
}
function isPass(m) {
  return canonType(m.type) === TYPES.CLASS_PASS;
}
/** 期限卡（月卡/季卡）且为「有效期内固定次数」策略：按 remainingCredits 计数 */
function isQuota(m) {
  return !isPass(m) && !!m.policy && m.policy.mode === 'quota';
}
/** 旧版月卡「每月限次」策略 */
function isLegacyMonthlyLimit(m) {
  return !isPass(m) && !!m.policy && m.policy.mode === 'limited';
}
function usesCredits(m) {
  return isPass(m) || isQuota(m);
}

/** 某张卡在 classDate 当天是否可用；返回 null 表示可用，否则返回原因码 */
function unusableReason(m, classDate) {
  if (m.status === 'suspended') return 'MEMBERSHIP_SUSPENDED';
  if (m.startDate && classDate < m.startDate) return 'MEMBERSHIP_NOT_STARTED';
  if (m.status === 'expired' || (m.expireDate && classDate > m.expireDate)) return 'MEMBERSHIP_EXPIRED';
  if (isPass(m) && !(m.remainingCredits > 0)) return 'INSUFFICIENT_CREDITS';
  if (isQuota(m) && !(m.remainingCredits > 0)) return 'QUOTA_EXHAUSTED';
  if (isLegacyMonthlyLimit(m)) {
    const used = (m.usage && m.usage[time.monthKey(classDate)]) || 0;
    if (used >= m.policy.monthlyLimit) return 'MONTHLY_LIMIT_REACHED';
  }
  return null;
}

const REASON_PRIORITY = ['INSUFFICIENT_CREDITS', 'QUOTA_EXHAUSTED', 'MONTHLY_LIMIT_REACHED', 'MEMBERSHIP_EXPIRED', 'MEMBERSHIP_NOT_STARTED', 'MEMBERSHIP_SUSPENDED'];
const REASON_TEXT = {
  NO_MEMBERSHIP: '暂无有效会员卡',
  INSUFFICIENT_CREDITS: '课时不足',
  QUOTA_EXHAUSTED: '有效期内次数已用完',
  MONTHLY_LIMIT_REACHED: '本月次数已用完',
  MEMBERSHIP_EXPIRED: '会员卡已过期',
  MEMBERSHIP_NOT_STARTED: '会员卡尚未生效',
  MEMBERSHIP_SUSPENDED: '会员卡已冻结',
};

/** 按策略选择可用会员卡：先到期的优先；同到期日次卡优先（保护月卡额度） */
function pickMembership(memberships, classDate) {
  const usable = [];
  const reasons = [];
  for (const m of memberships) {
    const r = unusableReason(m, classDate);
    if (r) reasons.push(r);
    else usable.push(m);
  }
  if (usable.length) {
    usable.sort((a, b) => (a.expireDate || '9999').localeCompare(b.expireDate || '9999') || (isPass(a) === isPass(b) ? 0 : isPass(a) ? -1 : 1));
    return { membership: usable[0], reason: null };
  }
  if (!memberships.length) return { membership: null, reason: 'NO_MEMBERSHIP' };
  const reason = REASON_PRIORITY.find((r) => reasons.includes(r)) || 'NO_MEMBERSHIP';
  return { membership: null, reason };
}

function balanceOf(m, month) {
  if (usesCredits(m)) return m.remainingCredits;
  if (isLegacyMonthlyLimit(m)) return m.policy.monthlyLimit - ((m.usage && m.usage[month]) || 0);
  return 0;
}

let seqCounter = 0;
/** 同一毫秒内的流水排序：createdAt + seq */
function nextSeq() {
  seqCounter = (seqCounter + 1) % 1000;
  return time.now() * 1000 + seqCounter;
}

async function writeTx(tx, data) {
  const createdAt = time.now();
  return tx.create('transactions', { ...data, createdAt, seq: nextSeq() });
}

/** 事务内：为一次出勤扣减。返回 deduction 描述 */
async function deductForAttendance(tx, m, classDate, operatorId, refId, reason) {
  const ts = time.now();
  const month = time.monthKey(classDate);
  const label = TYPE_LABEL[canonType(m.type)] || '会员卡';
  if (usesCredits(m)) {
    const prev = m.remainingCredits;
    if (!(prev > 0)) throw E.rule(isPass(m) ? 'INSUFFICIENT_CREDITS' : 'QUOTA_EXHAUSTED', isPass(m) ? '课时不足' : '有效期内次数已用完');
    await tx.update('memberships', m._id, {
      remainingCredits: prev - 1,
      usedCredits: (m.usedCredits || 0) + 1,
      updatedAt: ts,
    });
    await writeTx(tx, {
      studentId: m.studentId, membershipId: m._id, type: 'attendance_deduction',
      amount: -1, previousBalance: prev, newBalance: prev - 1,
      operatorId, reason: reason || (isPass(m) ? '上课签到' : `${label}签到（固定次数）`), refType: 'attendance', refId,
    });
    return { membershipId: m._id, kind: 'credit', month };
  }
  const used = (m.usage && m.usage[month]) || 0;
  const limited = isLegacyMonthlyLimit(m);
  if (limited && used >= m.policy.monthlyLimit) throw E.rule('MONTHLY_LIMIT_REACHED', '本月次数已用完');
  await tx.update('memberships', m._id, { [`usage.${month}`]: used + 1, usedCredits: (m.usedCredits || 0) + 1, updatedAt: ts });
  const prev = limited ? m.policy.monthlyLimit - used : 0;
  await writeTx(tx, {
    studentId: m.studentId, membershipId: m._id, type: 'attendance_deduction',
    amount: limited ? -1 : 0, previousBalance: prev, newBalance: limited ? prev - 1 : 0,
    operatorId, reason: reason || (limited ? `${label}签到（${month}）` : `${label}签到（不限次）`),
    refType: 'attendance', refId,
  });
  return { membershipId: m._id, kind: 'monthly', month };
}

/** 事务内：退还一次出勤的扣减 */
async function refundAttendance(tx, deduction, studentId, operatorId, refId, reason) {
  if (!deduction || !deduction.membershipId || deduction.kind === 'none') return;
  const m = await tx.get('memberships', deduction.membershipId);
  if (!m) return;
  const ts = time.now();
  if (deduction.kind === 'credit') {
    const prev = m.remainingCredits;
    await tx.update('memberships', m._id, {
      remainingCredits: prev + 1,
      usedCredits: Math.max(0, (m.usedCredits || 0) - 1),
      updatedAt: ts,
    });
    await writeTx(tx, {
      studentId, membershipId: m._id, type: 'refund', amount: 1,
      previousBalance: prev, newBalance: prev + 1, operatorId, reason, refType: 'attendance', refId,
    });
    return;
  }
  const used = (m.usage && m.usage[deduction.month]) || 0;
  const limited = isLegacyMonthlyLimit(m);
  await tx.update('memberships', m._id, { [`usage.${deduction.month}`]: Math.max(0, used - 1), usedCredits: Math.max(0, (m.usedCredits || 0) - 1), updatedAt: ts });
  const prev = limited ? m.policy.monthlyLimit - used : 0;
  await writeTx(tx, {
    studentId, membershipId: m._id, type: 'refund', amount: limited ? 1 : 0,
    previousBalance: prev, newBalance: limited ? prev + 1 : 0, operatorId, reason, refType: 'attendance', refId,
  });
}

/** 重新计算学员列表中展示的会员概要（非关键冗余字段） */
async function refreshSummary(store, studentId) {
  const list = await store.find('memberships', { studentId, status: { $in: ['active', 'suspended'] } });
  const today = time.today();
  const valid = list.filter((m) => m.status === 'active' && (!m.expireDate || m.expireDate >= today));
  let summary;
  if (!valid.length) {
    summary = { type: 'none', label: list.length ? '已过期' : '未开卡', remainingCredits: 0, expireDate: '', status: list.length ? 'expired' : 'none' };
  } else {
    const credits = valid.filter(isPass).reduce((s, m) => s + m.remainingCredits, 0);
    const period = valid.filter((m) => !isPass(m)).sort((a, b) => b.expireDate.localeCompare(a.expireDate))[0];
    const expire = valid.map((m) => m.expireDate).sort().reverse()[0];
    const pType = period ? canonType(period.type) : '';
    summary = {
      type: period ? pType : TYPES.CLASS_PASS,
      label: period ? (credits > 0 ? `${TYPE_LABEL[pType]} + 次卡` : TYPE_LABEL[pType]) : '次卡',
      remainingCredits: credits,
      expireDate: expire,
      status: 'active',
    };
  }
  await store.update('students', studentId, { membershipSummary: summary, updatedAt: time.now() });
  return summary;
}

module.exports = {
  TYPES, TYPE_LIST, TYPE_LABEL, PERIOD_MONTHS, canonType, isPass, isQuota, usesCredits,
  REASON_TEXT, unusableReason, pickMembership, balanceOf,
  deductForAttendance, refundAttendance, refreshSummary, writeTx,
};
