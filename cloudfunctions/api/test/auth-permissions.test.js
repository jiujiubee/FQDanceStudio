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

test('1a. 手机号必填：缺失手机号被拒绝', async () => {
  const env = await setup();
  const r = await env.call('p-openid', 'auth.registerStudent', { name: '甲', agreePrivacy: true });
  assert.equal(r.code, 'INVALID_ARGUMENT');
  assert.match(r.message, /手机号/);
});

test('1b. 手机号格式错误被拒绝（前后端一致的大陆号码规则）', async () => {
  const env = await setup();
  for (const p of ['123', '12800000000', '1380000000', '138000000000', 'abcdefghijk', '+1 2025550100']) {
    const r = await env.call('p-openid', 'auth.registerStudent', { name: '甲', phone: p, smsCode: '123456', agreePrivacy: true });
    assert.equal(r.code, 'INVALID_ARGUMENT', p);
  }
  const s = await env.call('p-openid', 'auth.sendSmsCode', { phone: '10086' });
  assert.equal(s.code, 'INVALID_ARGUMENT');
});

test('1c. 手工输入的手机号不视为已验证：无验证码被拒绝，错误验证码被拒绝', async () => {
  const env = await setup();
  const r = await env.call('p-openid', 'auth.registerStudent', { name: '甲', phone: '13700000000', agreePrivacy: true });
  assert.equal(r.code, 'PHONE_NOT_VERIFIED');
  await env.ok('p-openid', 'auth.sendSmsCode', { phone: '13700000000' });
  const wrong = await env.call('p-openid', 'auth.registerStudent', { name: '甲', phone: '13700000000', smsCode: '000000' === env.sms['13700000000'] ? '111111' : '000000', agreePrivacy: true });
  assert.equal(wrong.code, 'SMS_CODE_INVALID');
  const other = await env.call('p-openid', 'auth.registerStudent', { name: '甲', phone: '13700000001', smsCode: env.sms['13700000000'], agreePrivacy: true });
  assert.equal(other.code, 'SMS_CODE_INVALID');
  assert.equal(await env.store.count('students', { phone: '13700000000' }), 0);
});

test('1d. 重复手机号被拒绝并提示联系管理员', async () => {
  const env = await setup();
  await env.registerStudent('a-openid', { name: '甲', phone: '13600000000' });
  const viaSms = await env.call('b-openid', 'auth.registerStudent', { name: '乙', phone: '136 0000 0000', smsCode: '123456', agreePrivacy: true });
  assert.equal(viaSms.code, 'PHONE_EXISTS');
  assert.match(viaSms.message, /联系管理员/);
  env.wxPhones['dup-code'] = '13600000000';
  const viaWx = await env.call('c-openid', 'auth.registerStudent', { name: '丙', phoneCode: 'dup-code', agreePrivacy: true });
  assert.equal(viaWx.code, 'PHONE_EXISTS');
  const adminDup = await env.call('admin-openid', 'student.create', { name: '丁', phone: '13600000000' });
  assert.equal(adminDup.code, 'PHONE_EXISTS');
});

test('1e. 已验证手机号注册：微信快速验证与短信验证均记录验证状态与时间', async () => {
  const env = await setup();
  const r = await env.registerStudent('w-openid', { name: '微信', phone: '13500000000' });
  const s = await env.store.get('students', r.studentId);
  assert.equal(s.phone, '13500000000');
  assert.equal(s.phoneVerified, true);
  assert.equal(s.phoneVerifyMethod, 'wechat');
  assert.ok(s.phoneVerifiedAt > 0);

  await env.ok('m-openid', 'auth.sendSmsCode', { phone: '13500000001' });
  const again = await env.call('m-openid', 'auth.sendSmsCode', { phone: '13500000001' });
  assert.equal(again.code, 'TOO_FREQUENT');
  const r2 = await env.ok('m-openid', 'auth.registerStudent', { name: '短信', phone: '13500000001', smsCode: env.sms['13500000001'], agreePrivacy: true });
  const s2 = await env.store.get('students', r2.studentId);
  assert.equal(s2.phoneVerified, true);
  assert.equal(s2.phoneVerifyMethod, 'sms');
  const session = await env.ok('m-openid', 'auth.login');
  assert.equal(session.student.phoneVerified, true);
});

test('1f. 管理员登记档案（手机号未验证），学员用同一号码验证注册后自动关联，无需绑定码', async () => {
  const env = await setup();
  const created = await env.ok('admin-openid', 'student.create', { name: '线下学员', phone: '13400000000', wxid: 'offline_01' });
  assert.equal(created.bindCode, undefined);
  const before = await env.store.get('students', created.studentId);
  assert.equal(before.phoneVerified, false);
  const missing = await env.call('admin-openid', 'student.create', { name: '无号' });
  assert.equal(missing.code, 'INVALID_ARGUMENT');
  const r = await env.registerStudent('bind-openid', { name: '线下学员', phone: '13400000000' });
  assert.equal(r.studentId, created.studentId);
  assert.equal(r.linked, true);
  const after = await env.store.get('students', created.studentId);
  assert.equal(after.phoneVerified, true);
  const dup = await env.call('other-openid', 'auth.registerStudent', { name: 'x', phone: '13400000000', smsCode: '123456', agreePrivacy: true });
  assert.equal(dup.code, 'PHONE_EXISTS');
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

test('3. 店主授权：仅店主可授予店主/管理员；不能修改自己的角色', async () => {
  const env = await setup();
  await env.ok('owner2-openid', 'auth.setupAccount', { name: '合伙人', agreePrivacy: true });
  const o2 = env.uid('owner2-openid');
  const adminTry = await env.call('admin-openid', 'staff.grantRole', { userId: o2, role: 'owner' });
  assert.equal(adminTry.code, 'FORBIDDEN');
  await env.ok('owner-openid', 'staff.grantRole', { userId: o2, role: 'owner' });
  assert.deepEqual((await env.ok('owner2-openid', 'auth.login')).roles, ['owner']);
  await env.ok('owner-openid', 'staff.revokeRole', { userId: o2, role: 'owner' });
  const selfTry = await env.call('owner-openid', 'staff.revokeRole', { userId: env.uid('owner-openid'), role: 'owner' });
  assert.equal(selfTry.code, 'FORBIDDEN');
  const selfAdmin = await env.call('owner-openid', 'staff.grantRole', { userId: env.uid('owner-openid'), role: 'admin' });
  assert.equal(selfAdmin.code, 'FORBIDDEN');
});

test('4. 管理员授权边界：可管理教师，不能管理管理员/店主、不能改权限矩阵', async () => {
  const env = await setup();
  const staff = await env.ok('admin-openid', 'staff.list');
  const owner = staff.find((u) => u.roles.includes('owner'));
  const teacher = staff.find((u) => u.name === '王老师');
  assert.deepEqual(owner.revocable, []);
  const r1 = await env.call('admin-openid', 'staff.revokeRole', { userId: owner.userId, role: 'owner' });
  assert.equal(r1.code, 'FORBIDDEN');
  const r2 = await env.call('admin-openid', 'staff.grantRole', { userId: teacher.userId, role: 'admin' });
  assert.equal(r2.code, 'FORBIDDEN');
  await env.ok('admin-openid', 'staff.revokeRole', { userId: teacher.userId, role: 'teacher', reason: '离职' });
  const t = await env.call('teacher2-openid', 'teacher.dashboard', {});
  assert.equal(t.ok, false);
  const r3 = await env.call('admin-openid', 'permissions.update', { role: 'teacher', permissions: [] });
  assert.equal(r3.code, 'FORBIDDEN');
  const r4 = await env.call('admin-openid', 'settings.update', { membership: { monthlyDefaultMode: 'limited', monthlyDefaultLimit: 4, refundOnCancel: true, passDefaultValidDays: 90 } });
  assert.equal(r4.code, 'FORBIDDEN');
  // 管理员正常权限
  await env.ok('admin-openid', 'student.search', { keyword: '小' });
  await env.ok('admin-openid', 'transaction.list', {});
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
    ['staff.grantRole', { userId: 'u_x', role: 'admin' }],
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
  const grant = await env.call('admin-openid', 'staff.setTeacherPermissions', { teacherId: env.teacherId, permissions: ['class.view.all'] });
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
  await env.ok('admin-openid', 'student.setStatus', { studentId: env.studentId, status: 'suspended', reason: '欠费' });
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
