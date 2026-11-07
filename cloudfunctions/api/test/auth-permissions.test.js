'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('1. 学员自助注册：需同意隐私政策，不可重复注册', async () => {
  const env = await setup();
  const r = await env.call('new-openid', 'auth.registerStudent', { name: '新同学' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'INVALID_ARGUMENT');
  const ok = await env.registerStudent('new-openid', { name: '新同学', phone: '13800000000' });
  assert.ok(ok.studentId);
  const again = await env.call('new-openid', 'auth.registerStudent', { name: '新同学', phone: '13800000001', agreePrivacy: true });
  assert.equal(again.code, 'ALREADY_REGISTERED');
});

test('1a. 无需手机号与验证码即可注册：创建 User + Student 并赋予 student 角色', async () => {
  const env = await setup();
  const r = await env.ok('p-openid', 'auth.registerStudent', { name: '甲', agreePrivacy: true });
  const s = await env.store.get('students', r.studentId);
  assert.equal(s.userId, env.uid('p-openid'));
  assert.equal(s.phone, '');
  assert.equal(s.status, 'active');
  const u = await env.store.get('users', env.uid('p-openid'));
  assert.equal(u.studentId, r.studentId);
  assert.deepEqual(u.roles, ['student']);
  const session = await env.ok('p-openid', 'auth.login');
  assert.equal(session.registered, true);
  assert.equal(session.role, 'student');
});

test('1b. 姓名必填；手机号选填但格式错误时拒绝', async () => {
  const env = await setup();
  const noName = await env.call('p-openid', 'auth.registerStudent', { agreePrivacy: true });
  assert.equal(noName.code, 'INVALID_ARGUMENT');
  const bad = await env.call('p-openid', 'auth.registerStudent', { name: '甲', phone: '123', agreePrivacy: true });
  assert.equal(bad.code, 'INVALID_ARGUMENT');
  const ok = await env.ok('p-openid', 'auth.registerStudent', { name: '甲', phone: '13700000000', agreePrivacy: true });
  const s = await env.store.get('students', ok.studentId);
  assert.equal(s.phone, '13700000000');
});

test('1c. 同一 OpenID 不会重复创建学员档案', async () => {
  const env = await setup();
  await env.ok('d-openid', 'auth.registerStudent', { name: '甲', agreePrivacy: true });
  const again = await env.call('d-openid', 'auth.registerStudent', { name: '甲', agreePrivacy: true });
  assert.equal(again.code, 'ALREADY_REGISTERED');
  assert.equal(await env.store.count('students', { userId: env.uid('d-openid') }), 1);
});

test('1d. 新注册学员（无手机号）出现在店主学员管理列表', async () => {
  const env = await setup();
  const r = await env.ok('n-openid', 'auth.registerStudent', { name: '无号学员', agreePrivacy: true });
  const list = await env.ok('owner-openid', 'student.search', { status: 'all', page: 0 });
  assert.ok(list.items.some((x) => x._id === r.studentId));
});

test('1e. 管理员登记学员时手机号可留空', async () => {
  const env = await setup();
  const created = await env.ok('owner-openid', 'student.create', { name: '线下学员' });
  const s = await env.store.get('students', created.studentId);
  assert.equal(s.phone, '');
});

test('2. 微信登录：未注册返回 registered=false；OpenID 缺失被拒绝', async () => {
  const env = await setup();
  const s = await env.ok('unknown-openid', 'auth.login');
  assert.equal(s.registered, false);
  const s2 = await env.ok('student-openid', 'auth.login');
  assert.equal(s2.registered, true);
  assert.equal(s2.role, 'student');
  assert.equal(s2.privacyAgreed, true);
  const noId = await env.call(null, 'auth.login');
  assert.equal(noId.code, 'UNAUTHENTICATED');
  const unknownAction = await env.call('student-openid', 'not.exist');
  assert.equal(unknownAction.code, 'UNKNOWN_ACTION');
  const proto = await env.call('student-openid', '__proto__');
  assert.equal(proto.code, 'UNKNOWN_ACTION');
});

test('3. 店主授权：仅店主可授予店主；不能修改自己的店主角色；ADMIN 不再是有效角色', async () => {
  const env = await setup();
  await env.registerStudent('owner2-openid', { name: '合伙人' });
  const o2 = env.uid('owner2-openid');
  const teacherTry = await env.call('teacher-openid', 'staff.grantRole', { userId: o2, role: 'owner' });
  assert.equal(teacherTry.code, 'FORBIDDEN');
  await env.ok('owner-openid', 'staff.grantRole', { userId: o2, role: 'owner' });
  assert.deepEqual((await env.ok('owner2-openid', 'auth.login')).roles, ['owner', 'student']);
  await env.ok('owner-openid', 'staff.revokeRole', { userId: o2, role: 'owner' });
  const selfTry = await env.call('owner-openid', 'staff.revokeRole', { userId: env.uid('owner-openid'), role: 'owner' });
  assert.equal(selfTry.code, 'FORBIDDEN');
  for (const action of ['staff.grantRole', 'staff.revokeRole']) {
    const r = await env.call('owner-openid', action, { userId: env.uid('teacher-openid'), role: 'admin' });
    assert.equal(r.code, 'INVALID_ARGUMENT', action);
  }
  const perm = await env.call('owner-openid', 'permissions.update', { role: 'admin', permissions: [] });
  assert.equal(perm.code, 'INVALID_ARGUMENT');
  const matrix = await env.ok('owner-openid', 'permissions.get');
  assert.deepEqual(Object.keys(matrix.roles).sort(), ['student', 'teacher']);
  assert.ok(!matrix.all.includes('admin.manage'));
});

test('4. 教师授权边界：仅店主可授予/撤销教师，教师不能管理员工、不能改权限矩阵', async () => {
  const env = await setup();
  const staff = await env.ok('owner-openid', 'staff.list');
  const teacher = staff.find((u) => u.name === '王老师');
  for (const action of ['staff.list', 'staff.searchUsers']) {
    const r = await env.call('teacher-openid', action, { keyword: '老师' });
    assert.equal(r.code, 'FORBIDDEN', action);
  }
  const r1 = await env.call('teacher-openid', 'staff.revokeRole', { userId: teacher.userId, role: 'teacher' });
  assert.equal(r1.code, 'FORBIDDEN');
  const r2 = await env.call('teacher-openid', 'staff.grantRole', { userId: env.uid('student-openid'), role: 'teacher' });
  assert.equal(r2.code, 'FORBIDDEN');
  const r3 = await env.call('teacher-openid', 'permissions.update', { role: 'teacher', permissions: [] });
  assert.equal(r3.code, 'FORBIDDEN');
  const bad = await env.call('owner-openid', 'permissions.update', { role: 'teacher', permissions: ['teacher.manage'] });
  assert.equal(bad.code, 'INVALID_ARGUMENT');
  await env.ok('owner-openid', 'staff.revokeRole', { userId: teacher.userId, role: 'teacher', reason: '离职' });
  const t = await env.call('teacher2-openid', 'teacher.dashboard', {});
  assert.equal(t.ok, false);
  // 原管理员的管理功能归属店主
  await env.ok('owner-openid', 'student.search', { keyword: '小' });
  await env.ok('owner-openid', 'transaction.list', {});
});

test('5. 教师权限限制：不能改课时/会员、只能访问自己的课程、看不到财务信息', async () => {
  const env = await setup();
  const { membershipId } = await env.givePass(env.studentId, 10);
  const c1 = await env.createClass();
  const c2 = await env.createClass({ teacherId: env.teacher2Id, startTime: '14:00' });
  for (const [action, data] of [
    ['membership.adjustCredits', { membershipId, delta: 5, reason: 'x' }],
    ['membership.create', { studentId: env.studentId, type: 'pass', credits: 5, requestId: 'abcdefgh123' }],
    ['membership.renew', { membershipId }],
    ['staff.grantRole', { userId: 'u_x', role: 'teacher' }],
    ['settings.update', { studioName: 'x' }],
    ['transaction.list', {}],
    ['class.create', { mode: 'single' }],
  ]) {
    const r = await env.call('teacher-openid', action, data);
    assert.equal(r.code, 'FORBIDDEN', action);
  }
  await env.ok('teacher-openid', 'attendance.classDetail', { classId: c1.classes[0]._id });
  const other = await env.call('teacher-openid', 'attendance.classDetail', { classId: c2.classes[0]._id });
  assert.equal(other.code, 'FORBIDDEN');
  const markOther = await env.call('teacher-openid', 'attendance.mark', { classId: c2.classes[0]._id, studentId: env.studentId, status: 'present', reason: 'x' });
  assert.equal(markOther.code, 'FORBIDDEN');
  const dash = await env.ok('teacher-openid', 'teacher.dashboard', {});
  assert.deepEqual(dash.classes.map((c) => c._id), [c1.classes[0]._id]);
  // 学员信息：未上过课的学员不可见；签到后可见但无手机号/余额
  const hidden = await env.call('teacher-openid', 'student.get', { studentId: env.studentId });
  assert.equal(hidden.code, 'FORBIDDEN');
  await env.ok('student-openid', 'attendance.checkIn', { classId: c1.classes[0]._id });
  const s = await env.ok('teacher-openid', 'student.get', { studentId: env.studentId });
  assert.equal(s.student.phone, undefined);
  assert.equal(s.student.membershipSummary, undefined);
  assert.equal(s.memberships, null);
  // 额外权限授予（仅店主）可让教师查看全部课程
  const grant = await env.call('teacher-openid', 'staff.setTeacherPermissions', { teacherId: env.teacherId, permissions: ['class.view.all'] });
  assert.equal(grant.code, 'FORBIDDEN');
  await env.ok('owner-openid', 'staff.setTeacherPermissions', { teacherId: env.teacherId, permissions: ['class.view.all'] });
  await env.ok('teacher-openid', 'attendance.classDetail', { classId: c2.classes[0]._id });
  const bad = await env.call('owner-openid', 'staff.setTeacherPermissions', { teacherId: env.teacherId, permissions: ['credit.manage'] });
  assert.equal(bad.code, 'INVALID_ARGUMENT');
});

test('6. 学员权限限制：无法访问管理功能和他人信息', async () => {
  const env = await setup();
  const c = await env.createClass();
  for (const [action, data] of [
    ['student.search', {}],
    ['student.get', { studentId: env.student2Id }],
    ['attendance.classDetail', { classId: c.classes[0]._id }],
    ['attendance.mark', { classId: c.classes[0]._id, studentId: env.studentId, status: 'present', reason: 'x' }],
    ['teacher.dashboard', {}],
    ['class.cancel', { classId: c.classes[0]._id, reason: 'x' }],
    ['transaction.list', { studentId: env.student2Id }],
    ['audit.list', {}],
    ['maintenance.daily', {}],
    ['permissions.get', {}],
  ]) {
    const r = await env.call('student-openid', action, data);
    assert.equal(r.ok, false, action);
    assert.equal(r.code, 'FORBIDDEN', action);
  }
  // 即使在权限矩阵中配置，也不能给学员授予管理权限
  const r = await env.call('owner-openid', 'permissions.update', { role: 'student', permissions: ['student.view.all'] });
  assert.equal(r.code, 'INVALID_ARGUMENT');
  // 停用账户无法使用
  await env.ok('owner-openid', 'student.setStatus', { studentId: env.studentId, status: 'suspended', reason: '欠费' });
  const s = await env.call('student-openid', 'schedule.week', {});
  assert.equal(s.code, 'ACCOUNT_SUSPENDED');
});

test('6b. 可配置权限矩阵：店主收回教师手动签到权限后立即生效', async () => {
  const env = await setup();
  const c = await env.createClass();
  await env.givePass(env.studentId, 5);
  await env.ok('owner-openid', 'permissions.update', { role: 'teacher', permissions: ['class.view.assigned', 'attendance.view.assigned'] });
  const r = await env.call('teacher-openid', 'attendance.mark', { classId: c.classes[0]._id, studentId: env.studentId, status: 'present', reason: '补签' });
  assert.equal(r.code, 'FORBIDDEN');
  await env.ok('owner-openid', 'permissions.update', { role: 'teacher', reset: true });
  await env.ok('teacher-openid', 'attendance.mark', { classId: c.classes[0]._id, studentId: env.studentId, status: 'present', reason: '补签' });
});
