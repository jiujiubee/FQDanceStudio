'use strict';
const { MemoryStore } = require('../store/memory');
const { createApi } = require('../app');
const time = require('../lib/time');
const ids = require('../lib/ids');

// 2024-06-03 是周一；默认时钟 = 上海时间 10:00
const DEFAULT_NOW = time.toMs('2024-06-03', '10:00');

let rid = 0;
const reqId = () => `req${Date.now().toString(36)}${(rid += 1)}abcdef`;

async function setup(opts) {
  opts = opts || {};
  time.setClock(() => opts.now || DEFAULT_NOW);
  const store = new MemoryStore();
  const deletedFiles = [];
  const providers = {
    async getTempFileURLs(list) { const o = {}; for (const f of list) o[f] = `https://tmp.example/${encodeURIComponent(f)}`; return o; },
    async deleteFiles(list) { deletedFiles.push(...list); },
  };
  const handle = createApi(store, { env: opts.env || { APP_ENV: 'production' }, logger: false, providers });
  const call = async (openid, action, data, extra) => {
    // 预约即签到：旧用例中的学员自助签到等价于 booking.create（attendance.checkIn 已移除）
    if (action === 'attendance.checkIn') return legacyCheckIn(openid, data);
    return handle({ action, data, ...(extra || {}) }, openid);
  };
  const legacyCheckIn = async (openid, data) => {
    const r = await handle({ action: 'booking.create', data }, openid);
    if (r.ok || r.code !== 'ALREADY_BOOKED') return r;
    const u = await store.get('users', ids.userIdFromOpenid(openid));
    const att = await store.get('attendance', ids.attendanceId(data.classId, u.studentId));
    if (!att || att.status === 'present') return { ok: false, code: 'ALREADY_CHECKED_IN', message: '已签到，请勿重复签到' };
    // 已有预约但被更正为缺勤：旧语义允许本人重新签到
    const core = require('../lib/attendance-core');
    try {
      const d = await core.markPresent(store, { classId: data.classId, studentId: u.studentId, operatorId: u._id, source: 'self', enforceWindow: false });
      return { ok: true, data: d };
    } catch (e) { return { ok: false, code: e.code, message: e.message }; }
  };
  const autoBook = async (openid, classId) => {
    const u = await store.get('users', ids.userIdFromOpenid(openid));
    const cls = await store.get('classes', classId);
    if (!u || !u.studentId || !cls) return;
    const stu = await store.get('students', u.studentId);
    if (!stu) return;
    const bk = require('../lib/booking-core');
    const cur = await store.get('classBookings', bk.bookingId(classId, stu._id));
    if (cur && cur.status !== 'cancelled') return;
    for (let i = 0; i < 20; i += 1) { try { await store.transaction((tx) => bk.upsertBooking(tx, cls, stu, { source: 'self', operatorId: u._id, enforceCapacity: false, status: 'booked' })); return; } catch (e) { if (e.code !== 'TX_CONFLICT' && e.code !== 'ALREADY_BOOKED') throw e; } }
  };
  const ok = async (openid, action, data, extra) => {
    const r = await call(openid, action, data, extra);
    if (!r.ok) throw new Error(`${action} failed: ${r.code} ${r.message}`);
    return r.data;
  };
  const system = (action, data) => handle({ action, data }, null, { internal: true });
  const uid = (openid) => ids.userIdFromOpenid(openid);
  const env = { store, handle, call, ok, system, uid, deletedFiles, setNow: (ms) => time.setClock(() => ms) };
  let phoneSeq = 0;
  /** 学员注册：手机号为注册必填项，未指定时自动分配唯一的合法手机号 */
  env.registerStudent = (openid, data) => {
    const phone = data && data.phone !== undefined ? data.phone : `1990000${String((phoneSeq += 1)).padStart(4, '0')}`;
    return ok(openid, 'auth.registerStudent', { agreePrivacy: true, ...data, phone });
  };

  const account = (openid, name) => env.registerStudent(openid, { name });
  await account('owner-openid', '店主');
  const boot = await system('system.bootstrapOwner', { userId: uid('owner-openid') });
  if (!boot.ok) throw new Error(`bootstrap failed: ${boot.message}`);
  for (const [openid, name, role] of [
    ['teacher-openid', '林老师', 'teacher'],
    ['teacher2-openid', '王老师', 'teacher'],
  ]) {
    await account(openid, name);
    await ok('owner-openid', 'staff.grantRole', { userId: uid(openid), role });
  }
  const s1 = await env.registerStudent('student-openid', { name: '小美', wxid: 'xiaomei_88' });
  const s2 = await env.registerStudent('student2-openid', { name: '小雅' });

  env.teacherId = (await ok('teacher-openid', 'auth.login')).teacher._id;
  env.teacher2Id = (await ok('teacher2-openid', 'auth.login')).teacher._id;
  env.studentId = s1.studentId;
  env.student2Id = s2.studentId;

  env.createClass = async (extra) => {
    const r = await ok('owner-openid', 'class.create', {
      mode: 'single', name: '爵士舞基础', teacherId: env.teacherId, date: '2024-06-03',
      startTime: '10:30', duration: 60, requestId: reqId(), ...extra,
    });
    const list = await ok('owner-openid', 'class.list', { from: '2024-06-01', to: '2024-07-31' });
    return { ...r, classes: list.classes.filter((c) => c.seriesId === r.seriesId) };
  };
  env.givePass = (studentId, credits, extra) => ok('owner-openid', 'membership.create', {
    studentId, type: 'pass', credits, requestId: reqId(), ...extra,
  });
  return env;
}

module.exports = { setup, reqId, DEFAULT_NOW };
