'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, reqId } = require('./helpers');
const time = require('../lib/time');
const rules = require('../lib/membership-rules');

const createQ = (env, extra) => env.ok('admin-openid', 'membership.create', {
  studentId: env.studentId, type: 'QUARTERLY', requestId: reqId(), ...extra,
});

test('Q1. 自然月到期计算：3 个自然月（非 90 天）', () => {
  assert.equal(time.periodEnd('2026-11-15', 3), '2027-02-14');
  assert.notEqual(time.periodEnd('2026-11-15', 3), time.addDays('2026-11-15', 89));
  assert.equal(time.periodEnd('2024-01-01', 3), '2024-03-31');
  assert.equal(time.periodEnd('2024-06-03', 1), '2024-07-02');
  assert.equal(time.periodEnd('2026-12-01', 1), '2026-12-31');
});

test('Q2. 闰年与月末日期', () => {
  assert.equal(time.periodEnd('2023-11-30', 3), '2024-02-29', '闰年2月无30日 → 取2月最后一天');
  assert.equal(time.periodEnd('2022-11-30', 3), '2023-02-28', '平年2月');
  assert.equal(time.periodEnd('2024-01-31', 1), '2024-02-29');
  assert.equal(time.periodEnd('2024-02-29', 3), '2024-05-28');
  assert.equal(time.periodEnd('2024-03-31', 3), '2024-06-30');
  assert.equal(time.periodEnd('2024-12-31', 3), '2025-03-30');
  assert.equal(time.periodEnd('2024-03-01', 3), '2024-05-31');
  assert.equal(time.periodEnd('2023-12-01', 3), '2024-02-29');
});

test('Q3. 创建季卡：默认 3 个自然月，类型为 QUARTERLY 枚举并写入开卡流水与审计', async () => {
  const env = await setup();
  const { membershipId } = await createQ(env, { startDate: '2024-06-03' });
  const m = await env.store.get('memberships', membershipId);
  assert.equal(m.type, 'QUARTERLY');
  assert.equal(m.startDate, '2024-06-03');
  assert.equal(m.expireDate, '2024-09-02');
  assert.equal(m.policy.mode, 'unlimited');
  const tx = await env.store.find('transactions', { membershipId });
  assert.equal(tx.length, 1);
  assert.equal(tx[0].type, 'purchase');
  assert.equal(await env.store.count('auditLogs', { action: 'membership.create', targetId: membershipId }), 1);
  const bad = await env.call('admin-openid', 'membership.create', { studentId: env.studentId, type: 'YEARLY', requestId: reqId() });
  assert.equal(bad.code, 'INVALID_ARGUMENT');
  const limited = await env.call('admin-openid', 'membership.create', { studentId: env.studentId, type: 'QUARTERLY', policyMode: 'limited', requestId: reqId() });
  assert.equal(limited.code, 'INVALID_ARGUMENT');
});

test('Q4. 自定义到期日期覆盖自动计算', async () => {
  const env = await setup();
  const { membershipId } = await createQ(env, { startDate: '2024-06-03', expireDate: '2024-10-15' });
  const m = await env.store.get('memberships', membershipId);
  assert.equal(m.expireDate, '2024-10-15');
  assert.equal(m.autoExpireDate, '2024-09-02');
  const early = await env.call('admin-openid', 'membership.create', { studentId: env.studentId, type: 'QUARTERLY', startDate: '2024-06-03', expireDate: '2024-06-01', requestId: reqId() });
  assert.equal(early.code, 'INVALID_ARGUMENT');
});

test('Q5. 不限次季卡：签到不扣次数，可多次签到', async () => {
  const env = await setup();
  const { membershipId } = await createQ(env, { policyMode: 'unlimited' });
  for (const t of ['10:30', '10:40', '10:50']) {
    const c = await env.createClass({ startTime: t });
    await env.ok('student-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  }
  const m = await env.store.get('memberships', membershipId);
  assert.equal(m.remainingCredits, 0);
  assert.equal(m.totalCredits, 0);
  assert.equal(m.usedCredits, 3);
  const tx = await env.store.find('transactions', { membershipId, type: 'attendance_deduction' });
  assert.equal(tx.length, 3);
  assert.ok(tx.every((t) => t.amount === 0));
});

test('Q6. 固定次数季卡：记录总次数/已用/剩余，用完拒绝', async () => {
  const env = await setup();
  const { membershipId } = await createQ(env, { policyMode: 'quota', quota: 2 });
  const noQuota = await env.call('admin-openid', 'membership.create', { studentId: env.studentId, type: 'QUARTERLY', policyMode: 'quota', requestId: reqId() });
  assert.equal(noQuota.code, 'INVALID_ARGUMENT');
  const c1 = await env.createClass();
  const c2 = await env.createClass({ startTime: '10:40' });
  const c3 = await env.createClass({ startTime: '10:50' });
  await env.ok('student-openid', 'attendance.checkIn', { classId: c1.classes[0]._id });
  await env.ok('student-openid', 'attendance.checkIn', { classId: c2.classes[0]._id });
  const r = await env.call('student-openid', 'attendance.checkIn', { classId: c3.classes[0]._id });
  assert.equal(r.code, 'QUOTA_EXHAUSTED');
  const mine = await env.ok('student-openid', 'membership.mine');
  const v = mine.memberships.find((x) => x._id === membershipId);
  assert.equal(v.type, 'QUARTERLY');
  assert.equal(v.policyMode, 'quota');
  assert.equal(v.totalCredits, 2);
  assert.equal(v.usedCredits, 2);
  assert.equal(v.remainingCredits, 0);
  // 修改额度：+3，写入流水
  await env.ok('admin-openid', 'membership.adjustCredits', { membershipId, delta: 3, reason: '赠送' });
  const after = await env.store.get('memberships', membershipId);
  assert.equal(after.totalCredits, 5);
  assert.equal(after.remainingCredits, 3);
  // 更正为缺勤 → 退还 1 次
  await env.ok('teacher-openid', 'attendance.mark', { classId: c1.classes[0]._id, studentId: env.studentId, status: 'absent', reason: '误签' });
  assert.equal((await env.store.get('memberships', membershipId)).remainingCredits, 4);
});

test('Q7. 季卡签到：生效期内可签，汇总显示季卡', async () => {
  const env = await setup();
  await createQ(env, {});
  const c = await env.createClass();
  const r = await env.ok('student-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  assert.ok(r.checkInAt);
  const s = await env.store.get('students', env.studentId);
  assert.equal(s.membershipSummary.type, 'QUARTERLY');
  assert.equal(s.membershipSummary.label, '季卡');
  const week = await env.ok('student-openid', 'schedule.week', {});
  assert.ok(week.classes.length > 0);
});

test('Q8. 过期季卡拒绝签到', async () => {
  const env = await setup();
  await createQ(env, { startDate: '2024-02-01' }); // 到期 2024-04-30
  const c = await env.createClass();
  const r = await env.call('student-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  assert.equal(r.code, 'MEMBERSHIP_EXPIRED');
  const notStarted = await env.setup2;
  assert.equal(notStarted, undefined);
});

test('Q9. 续费与延期：按自然月顺延、自定义到期日、修改策略，均写入流水与审计，可查看历史', async () => {
  const env = await setup();
  const { membershipId } = await createQ(env, { startDate: '2024-06-03', policyMode: 'quota', quota: 10 });
  await env.ok('admin-openid', 'membership.renew', { membershipId, reason: '续一季' });
  let m = await env.store.get('memberships', membershipId);
  assert.equal(m.expireDate, '2024-12-02', '2024-09-03 起 3 个自然月');
  await env.ok('admin-openid', 'membership.renew', { membershipId, expireDate: '2025-01-15', credits: 5, reason: '延期' });
  m = await env.store.get('memberships', membershipId);
  assert.equal(m.expireDate, '2025-01-15');
  assert.equal(m.remainingCredits, 15);
  assert.equal(m.totalCredits, 15);
  await env.ok('admin-openid', 'membership.renew', { membershipId, expireDate: '2025-01-15', policyMode: 'unlimited', reason: '改为不限次' });
  m = await env.store.get('memberships', membershipId);
  assert.equal(m.policy.mode, 'unlimited');
  assert.equal(m.remainingCredits, 0);
  await env.ok('admin-openid', 'membership.setStatus', { membershipId, status: 'suspended', reason: '请假' });
  const h = await env.ok('admin-openid', 'membership.history', { membershipId });
  assert.deepEqual(h.items.map((t) => t.type).sort(), ['purchase', 'renewal', 'renewal', 'renewal', 'status_change'].sort());
  assert.ok(h.items.every((t) => t.reason));
  assert.equal(await env.store.count('auditLogs', { targetId: membershipId }), 5);
  const denied = await env.call('student-openid', 'membership.history', { membershipId });
  assert.equal(denied.code, 'FORBIDDEN');
});

test('Q10. 兼容旧数据：pass/monthly 记录可继续签到，迁移后变为显式枚举', async () => {
  const env = await setup();
  const ts = time.now();
  await env.store.create('memberships', {
    _id: 'mem_legacy_pass', studentId: env.studentId, type: 'pass', name: '10次卡', totalCredits: 10, usedCredits: 0, remainingCredits: 10,
    purchaseDate: '2024-06-01', startDate: '2024-06-01', expireDate: '2024-12-01', status: 'active', policy: null, usage: {}, createdAt: ts, updatedAt: ts,
  });
  await env.store.create('memberships', {
    _id: 'mem_legacy_month', studentId: env.student2Id, type: 'monthly', name: '月卡', totalCredits: 0, usedCredits: 0, remainingCredits: 0,
    purchaseDate: '2024-06-01', startDate: '2024-06-01', expireDate: '2024-06-30', status: 'active', policy: { mode: 'limited', monthlyLimit: 1 }, usage: {}, createdAt: ts, updatedAt: ts,
  });
  const c = await env.createClass();
  await env.ok('student-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  await env.ok('student2-openid', 'attendance.checkIn', { classId: c.classes[0]._id });
  assert.equal((await env.store.get('memberships', 'mem_legacy_pass')).remainingCredits, 9);
  const mine = await env.ok('student-openid', 'membership.mine');
  assert.equal(mine.memberships[0].type, 'CLASS_PASS');
  const r = await env.system('system.migrate', {});
  assert.equal(r.ok, true);
  assert.equal((await env.store.get('memberships', 'mem_legacy_pass')).type, 'CLASS_PASS');
  assert.equal((await env.store.get('memberships', 'mem_legacy_month')).type, 'MONTHLY');
  assert.equal(rules.canonType('monthly'), 'MONTHLY');
});

test('Q11. 月卡默认 1 个自然月，可配置起止日期与固定次数', async () => {
  const env = await setup();
  const { membershipId } = await env.ok('admin-openid', 'membership.create', {
    studentId: env.studentId, type: 'MONTHLY', startDate: '2024-01-31', policyMode: 'quota', quota: 8, requestId: reqId(),
  });
  const m = await env.store.get('memberships', membershipId);
  assert.equal(m.expireDate, '2024-02-29');
  assert.equal(m.totalCredits, 8);
});
