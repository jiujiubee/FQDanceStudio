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
  const sms = {};
  const wxPhones = {};
  const providers = {
    async sendSms(phone, code) { sms[phone] = code; },
    async resolveWxPhone(code) {
      if (!wxPhones[code]) throw new Error('invalid code');
      return { purePhoneNumber: wxPhones[code], countryCode: '86' };
    },
  };
  const handle = createApi(store, { env: opts.env || { APP_ENV: 'production' }, logger: false, providers });
  const call = async (openid, action, data, extra) => handle({ action, data, ...(extra || {}) }, openid);
  const ok = async (openid, action, data, extra) => {
    const r = await call(openid, action, data, extra);
    if (!r.ok) throw new Error(`${action} failed: ${r.code} ${r.message}`);
    return r.data;
  };
  const system = (action, data) => handle({ action, data }, null, { internal: true });
  const uid = (openid) => ids.userIdFromOpenid(openid);
  const env = { store, handle, call, ok, system, uid, sms, wxPhones, setNow: (ms) => time.setClock(() => ms) };
  let phoneSeq = 0;
  /** 通过微信手机号快速验证注册学员 */
  env.registerStudent = (openid, data) => {
    const phone = (data && data.phone) || `139${String((phoneSeq += 1)).padStart(8, '0')}`;
    const code = `wx-${openid}`;
    wxPhones[code] = phone;
    return ok(openid, 'auth.registerStudent', { agreePrivacy: true, ...data, phone: undefined, phoneCode: code });
  };

  const account = (openid, name) => ok(openid, 'auth.setupAccount', { name, agreePrivacy: true });
  await account('owner-openid', '店主');
  const boot = await system('system.bootstrapOwner', { userId: uid('owner-openid') });
  if (!boot.ok) throw new Error(`bootstrap failed: ${boot.message}`);
  for (const [openid, name, role] of [
    ['admin-openid', '管理员', 'admin'],
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
    const r = await ok('admin-openid', 'class.create', {
      mode: 'single', name: '爵士舞基础', teacherId: env.teacherId, date: '2024-06-03',
      startTime: '10:30', duration: 60, requestId: reqId(), ...extra,
    });
    const list = await ok('admin-openid', 'class.list', { from: '2024-06-01', to: '2024-07-31' });
    return { ...r, classes: list.classes.filter((c) => c.seriesId === r.seriesId) };
  };
  env.givePass = (studentId, credits, extra) => ok('admin-openid', 'membership.create', {
    studentId, type: 'pass', credits, requestId: reqId(), ...extra,
  });
  return env;
}

module.exports = { setup, reqId, DEFAULT_NOW };
