'use strict';
/** 会员卡与课时：开卡、续费、增减课时、冻结、流水查询。所有余额变动在事务中完成并写入流水。 */
const time = require('../lib/time');
const ids = require('../lib/ids');
const { E } = require('../lib/errors');
const { v } = require('../lib/validate');
const views = require('../lib/views');
const { P } = require('../lib/permissions');
const rules = require('../lib/membership-rules');
const { withRetry } = require('../lib/attendance-core');

async function loadActiveStudent(ctx, id) {
  const s = await ctx.store.get('students', v.id(id, '学员'));
  if (!s || s.status === 'deleted') throw E.notFound('学员');
  return s;
}

/**
 * 读取期限卡（月卡/季卡）出勤策略：
 * - unlimited：有效期内不限次数，不扣课时
 * - quota：有效期内固定次数（totalCredits/usedCredits/remainingCredits 记账）
 * - limited：旧版月卡「每月限次」，仅为兼容历史数据保留
 */
function readPolicy(ctx, data, type) {
  const def = type === rules.TYPES.MONTHLY ? ctx.settings.membership.monthlyDefaultMode : 'unlimited';
  const mode = v.oneOf(data.policyMode, '出勤策略', ['unlimited', 'quota', 'limited'], { optional: true, default: def === 'limited' ? 'unlimited' : def });
  if (mode === 'limited') {
    if (type !== rules.TYPES.MONTHLY) throw E.invalid('季卡不支持每月限次，请选择固定次数');
    const monthlyLimit = v.int(data.monthlyLimit, '每月次数', { optional: true, default: ctx.settings.membership.monthlyDefaultLimit, min: 1, max: 100 });
    return { policy: { mode, monthlyLimit }, quota: 0 };
  }
  if (mode === 'quota') {
    const quota = v.int(data.quota, '有效期内次数', { min: 1, max: 1000 });
    return { policy: { mode, quota }, quota };
  }
  return { policy: { mode: 'unlimited' }, quota: 0 };
}

function readType(val) {
  const t = rules.canonType(val);
  return v.oneOf(t, '会员类型', rules.TYPE_LIST);
}

module.exports = {
  /** 开卡（次卡 / 月卡 / 季卡） */
  async 'membership.create'(ctx, data) {
    ctx.require(P.MEMBERSHIP_MANAGE);
    const student = await loadActiveStudent(ctx, data.studentId);
    const type = readType(data.type);
    const startDate = data.startDate ? v.date(data.startDate, '生效日期') : time.today();
    const priceCents = v.int(data.priceCents, '金额', { optional: true, default: 0, min: 0, max: 100000000 });
    const reason = v.str(data.reason, '备注', { optional: true, max: 200 });
    const requestId = v.str(data.requestId, '请求编号', { max: 64, pattern: /^[A-Za-z0-9_-]{8,64}$/ });
    const _id = `mem_${ids.safeKey(requestId)}`;
    const ts = time.now();
    let doc;
    if (type === rules.TYPES.CLASS_PASS) {
      const credits = v.int(data.credits, '课时数', { min: 1, max: 500 });
      const expireDate = data.expireDate ? v.date(data.expireDate, '到期日期') : time.addDays(startDate, ctx.settings.membership.passDefaultValidDays);
      if (expireDate < startDate) throw E.invalid('到期日期不能早于生效日期');
      doc = {
        _id, studentId: student._id, type, name: v.str(data.name, '名称', { optional: true, max: 30 }) || `${credits}次卡`,
        totalCredits: credits, usedCredits: 0, remainingCredits: credits,
        purchaseDate: time.today(), startDate, expireDate, autoExpireDate: '', status: 'active', policy: null, usage: {},
        priceCents, createdBy: ctx.user._id, createdAt: ts, updatedAt: ts,
      };
    } else {
      const months = v.int(data.months, '月数', { optional: true, default: rules.PERIOD_MONTHS[type], min: 1, max: 36 });
      const autoExpireDate = time.periodEnd(startDate, months);
      const expireDate = data.expireDate ? v.date(data.expireDate, '到期日期') : autoExpireDate;
      if (expireDate < startDate) throw E.invalid('到期日期不能早于生效日期');
      const { policy, quota } = readPolicy(ctx, data, type);
      doc = {
        _id, studentId: student._id, type, name: v.str(data.name, '名称', { optional: true, max: 30 }) || rules.TYPE_LABEL[type],
        totalCredits: quota, usedCredits: 0, remainingCredits: quota,
        purchaseDate: time.today(), startDate, expireDate, autoExpireDate, status: 'active', policy, usage: {},
        priceCents, createdBy: ctx.user._id, createdAt: ts, updatedAt: ts,
      };
    }
    const existed = await ctx.store.get('memberships', _id);
    if (existed) return { membershipId: _id, idempotent: true };
    await ctx.store.transaction(async (tx) => {
      await tx.create('memberships', doc);
      await rules.writeTx(tx, {
        studentId: student._id, membershipId: _id, type: 'purchase', amount: doc.totalCredits,
        previousBalance: 0, newBalance: doc.remainingCredits, operatorId: ctx.user._id,
        reason: reason || `开卡：${doc.name}（${doc.startDate} 至 ${doc.expireDate}）`, refType: 'membership', refId: _id,
      });
    });
    await rules.refreshSummary(ctx.store, student._id);
    await ctx.audit('membership.create', 'membership', _id, null, views.membershipView(doc), reason);
    return { membershipId: _id };
  },

  /** 增加 / 扣减课时（仅次卡）。扣减必须填写原因；余额不足拒绝 */
  async 'membership.adjustCredits'(ctx, data) {
    ctx.require(P.CREDIT_MANAGE);
    const id = v.id(data.membershipId, '会员卡');
    const delta = v.int(data.delta, '调整数量', { min: -500, max: 500 });
    if (delta === 0) throw E.invalid('调整数量不能为0');
    const reason = v.str(data.reason, '原因', { max: 200 });
    let result;
    await withRetry(() => ctx.store.transaction(async (tx) => {
      const m = await tx.get('memberships', id);
      if (!m) throw E.notFound('会员卡');
      if (!rules.usesCredits(m)) throw E.rule('NOT_PASS', '不限次会员卡不支持调整次数');
      const prev = m.remainingCredits;
      const next = prev + delta;
      if (next < 0) throw E.rule('INSUFFICIENT_CREDITS', '剩余课时不足，无法扣减');
      await tx.update('memberships', id, {
        remainingCredits: next,
        totalCredits: delta > 0 ? m.totalCredits + delta : m.totalCredits,
        usedCredits: delta < 0 ? m.usedCredits - delta : m.usedCredits,
        status: m.status === 'expired' && next > 0 && m.expireDate >= time.today() ? 'active' : m.status,
        updatedAt: time.now(),
      });
      await rules.writeTx(tx, {
        studentId: m.studentId, membershipId: id, type: delta > 0 ? 'credit_add' : 'manual_deduction',
        amount: delta, previousBalance: prev, newBalance: next, operatorId: ctx.user._id, reason,
      });
      result = { studentId: m.studentId, previousBalance: prev, newBalance: next };
    }));
    await rules.refreshSummary(ctx.store, result.studentId);
    await ctx.audit('membership.adjust', 'membership', id, { remainingCredits: result.previousBalance }, { remainingCredits: result.newBalance }, reason);
    return result;
  },

  /** 续费：延长有效期，次卡可同时增加课时 */
  async 'membership.renew'(ctx, data) {
    ctx.require(P.MEMBERSHIP_MANAGE);
    const id = v.id(data.membershipId, '会员卡');
    const reason = v.str(data.reason, '备注', { optional: true, max: 200 });
    let result;
    await withRetry(() => ctx.store.transaction(async (tx) => {
      const m = await tx.get('memberships', id);
      if (!m) throw E.notFound('会员卡');
      const today = time.today();
      const base = m.expireDate >= today ? m.expireDate : time.addDays(today, -1);
      const type = rules.canonType(m.type);
      let expireDate;
      if (data.expireDate) expireDate = v.date(data.expireDate, '到期日期');
      else if (type !== rules.TYPES.CLASS_PASS) {
        const months = v.int(data.months, '月数', { optional: true, default: rules.PERIOD_MONTHS[type], min: 1, max: 36 });
        expireDate = time.periodEnd(time.addDays(base, 1), months);
      } else expireDate = time.addDays(base, v.int(data.days, '延长天数', { optional: true, default: ctx.settings.membership.passDefaultValidDays, min: 1, max: 1000 }));
      if (expireDate < today) throw E.invalid('到期日期不能早于今天');
      if (expireDate < m.startDate) throw E.invalid('到期日期不能早于生效日期');
      const credits = rules.usesCredits(m) ? v.int(data.credits, '增加次数', { optional: true, default: 0, min: 0, max: 1000 }) : 0;
      const prev = m.remainingCredits || 0;
      const patch = { expireDate, status: 'active', updatedAt: time.now() };
      if (credits) Object.assign(patch, { remainingCredits: prev + credits, totalCredits: (m.totalCredits || 0) + credits });
      if (type !== rules.TYPES.CLASS_PASS && data.policyMode) {
        const { policy, quota } = readPolicy(ctx, data, type);
        patch.policy = policy;
        if (policy.mode === 'quota') Object.assign(patch, { totalCredits: (m.usedCredits || 0) + quota, remainingCredits: quota });
        else Object.assign(patch, { totalCredits: 0, remainingCredits: 0 });
      }
      await tx.update('memberships', id, patch);
      const next = patch.remainingCredits !== undefined ? patch.remainingCredits : prev;
      await rules.writeTx(tx, {
        studentId: m.studentId, membershipId: id, type: 'renewal', amount: next - prev,
        previousBalance: prev, newBalance: next, operatorId: ctx.user._id,
        reason: reason || `续费/延期：${m.expireDate} → ${expireDate}`, refType: 'membership', refId: id,
      });
      result = {
        studentId: m.studentId,
        before: { expireDate: m.expireDate, remainingCredits: prev, policy: m.policy || null },
        after: { expireDate, remainingCredits: next, policy: patch.policy || m.policy || null },
      };
    }));
    await rules.refreshSummary(ctx.store, result.studentId);
    await ctx.audit('membership.renew', 'membership', id, result.before, result.after, reason);
    return result.after;
  },

  async 'membership.setStatus'(ctx, data) {
    ctx.require(P.MEMBERSHIP_MANAGE);
    const id = v.id(data.membershipId, '会员卡');
    const status = v.oneOf(data.status, '状态', ['active', 'suspended']);
    const reason = v.str(data.reason, '原因', { max: 200 });
    const m = await ctx.store.get('memberships', id);
    if (!m) throw E.notFound('会员卡');
    if (status === 'active' && m.expireDate < time.today()) throw E.rule('MEMBERSHIP_EXPIRED', '会员卡已过期，请续费');
    await ctx.store.transaction(async (tx) => {
      await tx.update('memberships', id, { status, updatedAt: time.now() });
      await rules.writeTx(tx, {
        studentId: m.studentId, membershipId: id, type: 'status_change', amount: 0,
        previousBalance: m.remainingCredits || 0, newBalance: m.remainingCredits || 0, operatorId: ctx.user._id,
        reason: `${status === 'suspended' ? '冻结' : '解冻'}：${reason}`, refType: 'membership', refId: id,
      });
    });
    await rules.refreshSummary(ctx.store, m.studentId);
    await ctx.audit('membership.status', 'membership', id, { status: m.status }, { status }, reason);
    return { status };
  },

  /** 单张会员卡的变动历史（流水） */
  async 'membership.history'(ctx, data) {
    ctx.require(P.TRANSACTION_VIEW);
    const id = v.id(data.membershipId, '会员卡');
    const m = await ctx.store.get('memberships', id);
    if (!m) throw E.notFound('会员卡');
    const list = await ctx.store.find('transactions', { membershipId: id }, { orderBy: [['createdAt', 'desc'], ['seq', 'desc']], limit: 200 });
    return {
      membership: views.membershipView(m),
      items: list.map((t) => ({
        _id: t._id, type: t.type, amount: t.amount, previousBalance: t.previousBalance, newBalance: t.newBalance,
        operatorId: t.operatorId, reason: t.reason, createdAt: t.createdAt,
      })),
    };
  },

  async 'transaction.list'(ctx, data) {
    ctx.require(P.TRANSACTION_VIEW);
    const where = {};
    if (data.studentId) where.studentId = v.id(data.studentId, '学员');
    if (data.type) where.type = v.oneOf(data.type, 'TYPE_LABEL_PLACEHOLDER', ['purchase', 'credit_add', 'attendance_deduction', 'manual_deduction', 'refund', 'renewal', 'expiration', 'status_change']);
    const page = v.int(data.page, '页码', { optional: true, default: 0, min: 0 });
    const list = await ctx.store.find('transactions', where, { orderBy: [['createdAt', 'desc'], ['seq', 'desc']], skip: page * 30, limit: 31 });
    const sids = [...new Set(list.map((t) => t.studentId))];
    const uids = [...new Set(list.map((t) => t.operatorId).filter(Boolean))];
    const students = sids.length ? await ctx.store.find('students', { _id: { $in: sids } }) : [];
    const users = uids.length ? await ctx.store.find('users', { _id: { $in: uids } }) : [];
    const sn = new Map(students.map((s) => [s._id, s.name]));
    const un = new Map(users.map((u) => [u._id, u.name]));
    return {
      items: list.slice(0, 30).map((t) => ({
        _id: t._id, studentId: t.studentId, studentName: sn.get(t.studentId) || '', membershipId: t.membershipId,
        type: t.type, amount: t.amount, previousBalance: t.previousBalance, newBalance: t.newBalance,
        operatorName: t.operatorId === 'system' ? '系统' : un.get(t.operatorId) || '', reason: t.reason, createdAt: t.createdAt,
      })),
      hasMore: list.length > 30,
    };
  },
};
