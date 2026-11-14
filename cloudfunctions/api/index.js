'use strict';
/**
 * 云函数入口。OpenID 由微信云开发运行时注入（getWXContext），
 * 在服务端完成 wx.login code → OpenID 的换取，客户端无法伪造。
 * AppSecret 不需要也不会出现在任何前端代码中。
 */
const cloud = require('wx-server-sdk');
const { createCloudStore } = require('./store/cloud');
const { createApi } = require('./app');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 外部能力：云存储临时链接与文件删除。
 */
const providers = {
  async getTempFileURLs(fileIds) {
    const r = await cloud.getTempFileURL({ fileList: fileIds });
    const out = {};
    for (const f of (r && r.fileList) || []) if (f.status === 0 && f.tempFileURL) out[f.fileID] = f.tempFileURL;
    return out;
  },
  async deleteFiles(fileIds) {
    await cloud.deleteFile({ fileList: fileIds });
  },
};
const handle = createApi(createCloudStore(cloud), { providers });

const COLLECTIONS = [
  'users', 'teachers', 'students', 'classes', 'classSeries', 'attendance', 'attendanceRosters',
  'memberships', 'transactions', 'rolePermissions', 'auditLogs', 'systemSettings', 'staffInvites',
    'phoneIndex', 'classBookings',
];
let ready = null;
// 首次调用时自动创建集合（已存在则忽略），无需在控制台手动建表
function ensureCollections() {
  if (!ready) {
    const db = cloud.database();
    ready = Promise.all(COLLECTIONS.map((c) => db.createCollection(c).catch(() => null)));
  }
  return ready;
}

// 仅允许在「无用户身份」的服务端调用中执行的运维操作（云开发控制台「云端测试」或 tcb CLI 调用时没有 OPENID）。
// 小程序客户端调用必然携带 OPENID，因此无法触发这些操作。请勿为本云函数开启 HTTP 访问服务。
const CONSOLE_ACTIONS = new Set(['system.bootstrapOwner', 'system.migrate', 'maintenance.daily']);

exports.main = async (event) => {
  await ensureCollections();
  // 定时触发器
  if (event && event.Type === 'Timer') {
    return handle({ action: 'maintenance.daily', data: {} }, null, { internal: true });
  }
  const { OPENID } = cloud.getWXContext();
  if (!OPENID && event && CONSOLE_ACTIONS.has(event.action)) {
    return handle({ action: event.action, data: event.data || {} }, null, { internal: true });
  }
  return handle(event, OPENID);
};
