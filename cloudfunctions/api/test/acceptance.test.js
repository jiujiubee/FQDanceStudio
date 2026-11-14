'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, reqId, DEFAULT_NOW } = require('./helpers');

const raw = (env, openid, action, data) => env.handle({ action, data }, openid);
const credits = async (env, openid) => (await env.ok(openid, 'membership.mine')).memberships[0].remainingCredits;

test('A1. 预约后课时立即减少，流水记录扣除前后余额、学员、课程', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  const c = await env.createClass({ startTime: '12:00' });
  const classId = c.classes[0]._id;
  const r = await env.ok('student-openid', 'booking.create', { classId });
  assert.equal(r.status, 'checked_in');
  assert.equal(r.summary.remainingCredits, 4, '接口返回的余额来自数据库');
  assert.equal(await credits(env, 'student-openid'), 4);
  const txs = (await env.ok('owner-openid', 'transaction.list', { studentId: env.studentId, type: 'attendance_deduction' })).items;
  assert.equal(txs.length, 1);
  assert.equal(txs[0].previousBalance, 5);
  assert.equal(txs[0].newBalance, 4);
  assert.equal(txs[0].refId, `${classId}_${env.studentId}`);
  assert.ok(txs[0].createdAt);
});

test('A1b. 课时不足/过期时预约失败，不留下预约记录也不扣课', async () => {
  const env = await setup();
  const c = await env.createClass({ startTime: '12:00' });
  const classId = c.classes[0]._id;
  const r = await raw(env, 'student-openid', 'booking.create', { classId });
  assert.equal(r.ok, false);
  assert.equal(await env.store.get('classBookings', `bk_${classId}_${env.studentId}`), null);
  assert.equal(await env.store.get('attendance', `${classId}_${env.studentId}`), null);
  assert.equal((await env.store.get('classes', classId)).bookedCount || 0, 0);
});

test('A1c. 无限次会员预约不扣次数；取消后保留取消记录', async () => {
  const env = await setup();
  await env.ok('owner-openid', 'membership.create', { studentId: env.studentId, type: 'monthly', months: 1, policyMode: 'unlimited', requestId: reqId() });
  const c = await env.createClass({ startTime: '12:00' });
  const classId = c.classes[0]._id;
  await env.ok('student-openid', 'booking.create', { classId });
  await env.ok('student-openid', 'booking.cancel', { classId });
  assert.equal((await env.store.get('classBookings', `bk_${classId}_${env.studentId}`)).status, 'cancelled');
  const txs = (await env.ok('owner-openid', 'transaction.list', { studentId: env.studentId })).items;
  assert.ok(txs.filter((t) => t.type !== 'purchase').every((t) => t.amount === 0));
});

test('A2. 学生端无签到入口：接口不存在、课程卡片无签到按钮', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  const c = await env.createClass({ startTime: '10:40' });
  const classId = c.classes[0]._id;
  await env.ok('student-openid', 'booking.create', { classId });
  const ci = await raw(env, 'student-openid', 'attendance.checkIn', { classId });
  assert.equal(ci.code, 'UNKNOWN_ACTION');
  const week = await env.ok('student-openid', 'schedule.week', {});
  const card = week.classes.find((x) => x._id === classId);
  assert.equal(card.state, 'checked_in');
  assert.equal(card.canCheckIn, false);
  const root = path.join(__dirname, '..', '..', '..', 'miniprogram');
  for (const f of ['components/class-card/index.wxml', 'pages/class-detail/index.wxml', 'pages/schedule/index.wxml', 'pages/class-detail/index.ts', 'pages/schedule/index.ts']) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/catchtap="checkin"|bindtap="checkIn"|bind:checkin|attendance\.checkIn/.test(s), `学生端签到入口仍存在：${f}`);
  }
  // 教师端仍可查看名单与签到状态
  const d = await env.ok('teacher-openid', 'attendance.classDetail', { classId });
  assert.equal(d.stats.checkedIn, 1);
});

test('A3/A4/A5. 30分钟取消规则、返还课时、不重复扣课/退款、释放名额', async () => {
  const env = await setup();
  await env.ok('owner-openid', 'settings.update', { booking: { bookingCancellationCutoffMinutes: 30 } });
  await env.givePass(env.studentId, 5);
  const ok = await env.createClass({ startTime: '10:31', capacity: 1 });
  const late = await env.createClass({ startTime: '10:30' });
  const okId = ok.classes[0]._id;
  const lateId = late.classes[0]._id;
  await env.ok('student-openid', 'booking.create', { classId: okId });
  const dup = await raw(env, 'student-openid', 'booking.create', { classId: okId });
  assert.equal(dup.code, 'ALREADY_BOOKED');
  assert.equal(await credits(env, 'student-openid'), 4, '重复请求不重复扣课');
  const cancel = await env.ok('student-openid', 'booking.cancel', { classId: okId });
  assert.equal(cancel.refunded, true);
  assert.equal(cancel.summary.remainingCredits, 5);
  assert.equal((await env.store.get('classes', okId)).bookedCount, 0, '释放名额');
  const again = await raw(env, 'student-openid', 'booking.cancel', { classId: okId });
  assert.equal(again.ok, false);
  assert.equal(await credits(env, 'student-openid'), 5, '不重复退款');

  await env.ok('student-openid', 'booking.create', { classId: lateId });
  const closed = await raw(env, 'student-openid', 'booking.cancel', { classId: lateId });
  assert.equal(closed.code, 'CANCEL_CLOSED');
  assert.equal(await credits(env, 'student-openid'), 4);
  assert.equal((await env.store.get('classBookings', `bk_${lateId}_${env.studentId}`)).status, 'checked_in');

  const txs = (await env.ok('owner-openid', 'transaction.list', { studentId: env.studentId })).items;
  assert.equal(txs.filter((t) => t.type === 'attendance_deduction').length, 2);
  assert.equal(txs.filter((t) => t.type === 'refund').length, 1);
  const m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, txs[0].newBalance, '数据库余额与最新流水一致');
});

test('A6. 连续创建 3 节不同课程均真实保存，重复提交同一请求不重复创建', async () => {
  const env = await setup({ now: DEFAULT_NOW });
  const ids = [];
  for (const [i, st] of ['14:00', '16:00', '18:00'].entries()) {
    const r = await env.ok('owner-openid', 'class.create', {
      mode: 'single', name: `课程${i}`, teacherId: env.teacherId, date: '2024-06-04', startTime: st, duration: 60, requestId: reqId(),
    });
    assert.equal(r.created, 1);
    for (const id of r.classIds) assert.ok(await env.store.get('classes', id), '数据库中存在');
    ids.push(...r.classIds);
  }
  assert.equal(new Set(ids).size, 3);
  const list = await env.ok('owner-openid', 'class.list', { from: '2024-06-04', to: '2024-06-04' });
  assert.equal(list.classes.length, 3);
  const rid = reqId();
  const payload = { mode: 'single', name: '重复点击', teacherId: env.teacherId, date: '2024-06-05', startTime: '10:00', duration: 60, requestId: rid };
  const [a, b] = await Promise.all([raw(env, 'owner-openid', 'class.create', payload), raw(env, 'owner-openid', 'class.create', payload)]);
  assert.ok(a.ok || b.ok);
  assert.equal((await env.ok('owner-openid', 'class.list', { from: '2024-06-05', to: '2024-06-05' })).classes.length, 1);
});
