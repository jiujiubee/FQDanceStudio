'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, DEFAULT_NOW } = require('./helpers');

// 直接调用（不经过 helpers 的自动预约）
const raw = (env, openid, action, data) => env.handle({ action, data }, openid);

test('B1. 预约只占名额不扣课时；签到后扣课时；重复预约被拒绝', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  const c = await env.createClass({ capacity: 2 });
  const classId = c.classes[0]._id;
  const r = await raw(env, 'student-openid', 'booking.create', { classId });
  assert.ok(r.ok, r.message);
  let m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 4, '预约即签到并扣课时');
  const dup = await raw(env, 'student-openid', 'booking.create', { classId });
  assert.equal(dup.code, 'ALREADY_BOOKED');
  assert.equal((await env.store.get('classes', classId)).bookedCount, 1);
  const week = await env.ok('student-openid', 'schedule.week', {});
  assert.equal(week.classes.find((x) => x._id === classId).state, 'checked_in');
  assert.equal((await env.store.get('classBookings', `bk_${classId}_${env.studentId}`)).status, 'checked_in');
  const ci = await raw(env, 'student-openid', 'attendance.checkIn', { classId });
  assert.equal(ci.code, 'UNKNOWN_ACTION', '学员自主签到接口已移除');
  m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 4, '不重复扣费');
  const tx = await env.ok('owner-openid', 'transaction.list', { studentId: env.studentId });
  assert.equal(tx.items.filter((t) => t.type === 'attendance_deduction').length, 1);
});

test('B1b. 开课前超过30分钟取消：退还课时并生成流水；不重复退款；不计入上课记录', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  const c = await env.createClass({ startTime: '10:31' });
  const classId = c.classes[0]._id;
  await env.ok('student-openid', 'booking.create', { classId });
  await env.ok('student-openid', 'booking.cancel', { classId });
  let m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 5);
  const again = await raw(env, 'student-openid', 'booking.cancel', { classId });
  assert.equal(again.ok, false);
  m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 5, '不重复退款');
  const tx = await env.ok('owner-openid', 'transaction.list', { studentId: env.studentId });
  assert.deepEqual(tx.items.map((t) => t.type), ['refund', 'attendance_deduction', 'purchase']);
  assert.equal((await env.store.get('attendance', `${classId}_${env.studentId}`)).status, 'cancelled');
  assert.equal((await env.store.get('classBookings', `bk_${classId}_${env.studentId}`)).status, 'cancelled');
  env.setNow(DEFAULT_NOW + 120 * 60000);
  const h = await env.ok('student-openid', 'attendance.myHistory', {});
  assert.equal(h.completedTotal, 0);
});

test('B2. 未预约不能自助签到；满员不能预约；取消释放名额且保留记录', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  await env.givePass(env.student2Id, 5);
  const c = await env.createClass({ capacity: 1, startTime: '18:00' });
  const classId = c.classes[0]._id;
  const nb = await raw(env, 'student2-openid', 'attendance.checkIn', { classId });
  assert.equal(nb.code, 'UNKNOWN_ACTION');
  await env.ok('student-openid', 'booking.create', { classId });
  const full = await raw(env, 'student2-openid', 'booking.create', { classId });
  assert.equal(full.code, 'CLASS_FULL');
  await env.ok('student-openid', 'booking.cancel', { classId });
  assert.equal((await env.store.get('classes', classId)).bookedCount, 0);
  assert.equal((await env.store.get('classBookings', `bk_${classId}_${env.studentId}`)).status, 'cancelled');
  await env.ok('student2-openid', 'booking.create', { classId });
  const mine = await env.ok('student-openid', 'booking.mine', { scope: 'upcoming' });
  assert.equal(mine.items[0].status, 'cancelled');
  // 取消后可再次预约（复用同一记录）——此时已满
  const re = await raw(env, 'student-openid', 'booking.create', { classId });
  assert.equal(re.code, 'CLASS_FULL');
});

test('B3. 并发预约不超过容量', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  await env.givePass(env.student2Id, 5);
  const c = await env.createClass({ capacity: 1, startTime: '18:00' });
  const classId = c.classes[0]._id;
  const rs = await Promise.all([
    raw(env, 'student-openid', 'booking.create', { classId }),
    raw(env, 'student2-openid', 'booking.create', { classId }),
  ]);
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.equal((await env.store.get('classes', classId)).bookedCount, 1);
});

test('B4. 开课前取消截止；课程开始后不能预约', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 5);
  await env.givePass(env.student2Id, 5);
  const c = await env.createClass({ startTime: '10:29' });
  const classId = c.classes[0]._id;
  await env.ok('student-openid', 'booking.create', { classId });
  const late = await raw(env, 'student-openid', 'booking.cancel', { classId });
  assert.equal(late.code, 'CANCEL_CLOSED');
  const lm = await env.ok('student-openid', 'membership.mine');
  assert.equal(lm.memberships[0].remainingCredits, 4, '未取消不退款');
  env.setNow(DEFAULT_NOW + 65 * 60000);
  const started = await raw(env, 'student2-openid', 'booking.create', { classId });
  assert.equal(started.code, 'CLASS_STARTED');
});

test('B5. 教师添加未预约学员：自动生成预约、仅扣一次；更正缺勤退款', async () => {
  const env = await setup();
  await env.givePass(env.student2Id, 3);
  const c = await env.createClass({ capacity: 1 });
  const classId = c.classes[0]._id;
  await env.ok('teacher-openid', 'attendance.mark', { classId, studentId: env.student2Id, status: 'present', reason: '临时到场' });
  const b = await env.store.get('classBookings', `bk_${classId}_${env.student2Id}`);
  assert.equal(b.status, 'checked_in');
  assert.equal(b.source, 'teacher');
  assert.equal((await env.store.get('attendance', `${classId}_${env.student2Id}`)).checkInType, 'teacher_proxy');
  let m = await env.ok('student2-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 2);
  const dup = await raw(env, 'teacher-openid', 'attendance.mark', { classId, studentId: env.student2Id, status: 'present', reason: '再点一次' });
  assert.equal(dup.ok, false);
  m = await env.ok('student2-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 2);
  const d = await env.ok('teacher-openid', 'attendance.classDetail', { classId });
  assert.equal(d.stats.booked, 1);
  await env.ok('teacher-openid', 'attendance.mark', { classId, studentId: env.student2Id, status: 'absent', reason: '误签' });
  m = await env.ok('student2-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 3);
  assert.equal((await env.store.get('classBookings', `bk_${classId}_${env.student2Id}`)).status, 'booked');
});

test('B6. 取消课程：已签到退款，预约保留并标记取消', async () => {
  const env = await setup();
  await env.givePass(env.studentId, 3);
  const c = await env.createClass();
  const classId = c.classes[0]._id;
  await env.ok('student-openid', 'booking.create', { classId });
  const r = await raw(env, 'owner-openid', 'class.cancel', { classId, reason: '老师生病', refund: true });
  assert.ok(r.ok, r.message);
  const m = await env.ok('student-openid', 'membership.mine');
  assert.equal(m.memberships[0].remainingCredits, 3);
  const b = await env.store.get('classBookings', `bk_${classId}_${env.studentId}`);
  assert.equal(b.status, 'cancelled');
  assert.ok(b.classCancelled);
});

test('B7. 店主从学员详情设为/撤销老师；列表显示身份；首页显示导师', async () => {
  const env = await setup();
  const r = await raw(env, 'teacher-openid', 'student.setTeacher', { studentId: env.studentId, enable: true });
  assert.equal(r.code, 'FORBIDDEN');
  await env.ok('owner-openid', 'student.setTeacher', { studentId: env.studentId, enable: true });
  let s = await env.ok('student-openid', 'auth.login');
  assert.ok(s.roles.includes('teacher') && s.roles.includes('student'));
  const list = await env.ok('owner-openid', 'student.search', { keyword: '小美' });
  assert.ok(list.items[0].roles.includes('teacher'));
  const home = await env.ok('student2-openid', 'home.get', {});
  assert.ok(home.teachers.some((t) => t.name === '小美'));
  const detail = await env.ok('owner-openid', 'student.get', { studentId: env.studentId });
  assert.equal(detail.account.canRevokeTeacher, true);
  await env.ok('owner-openid', 'student.setTeacher', { studentId: env.studentId, enable: false });
  s = await env.ok('student-openid', 'auth.login');
  assert.ok(!s.roles.includes('teacher') && s.roles.includes('student'));
  const home2 = await env.ok('student2-openid', 'home.get', {});
  assert.ok(!home2.teachers.some((t) => t.name === '小美'));
});

test('B8. 历史账号（有 users 无 students）登录后自动补建学员档案并出现在列表', async () => {
  const env = await setup();
  const ts = Date.now();
  await env.store.create('users', {
    _id: env.uid('old-openid'), openid: 'old-openid', roles: [], role: null, status: 'active', name: '老用户', wxid: '', privacyAgreedVersion: 'x', createdAt: ts, updatedAt: ts,
  });
  const s = await env.ok('old-openid', 'auth.login');
  assert.ok(s.roles.includes('student'));
  const list = await env.ok('owner-openid', 'student.search', { keyword: '老用户' });
  assert.equal(list.items.length, 1);
  await env.ok('old-openid', 'auth.login');
  assert.equal((await env.store.find('students', { userId: env.uid('old-openid') })).length, 1, '重复登录不重复建档');
});

test('B9. 店主维护首页资料与导师资料；学员不能修改', async () => {
  const env = await setup();
  const deny = await raw(env, 'student-openid', 'studio.update', { intro: 'x' });
  assert.equal(deny.ok, false);
  await env.ok('owner-openid', 'studio.update', { intro: '专业舞蹈工作室', address: '上海市某路1号', features: ['爵士', '韩舞'] });
  const h = await env.ok('student-openid', 'home.get', {});
  assert.equal(h.intro, '专业舞蹈工作室');
  assert.deepEqual(h.features, ['爵士', '韩舞']);
  await env.ok('owner-openid', 'teacher.updateProfile', { teacherId: env.teacherId, intro: '十年爵士', styles: ['Jazz'], experience: '多年教学' });
  const t = await env.ok('student-openid', 'teacher.publicGet', { teacherId: env.teacherId });
  assert.deepEqual(t.styles, ['Jazz']);
});
