'use strict';
/** 视图投影：数据最小化，按角色裁剪返回字段 */

function studentForSelf(s) {
  if (!s) return null;
  return {
    _id: s._id, studentNo: s.studentNo, name: s.name, avatar: s.avatar || '', phone: s.phone || '',
        phoneVerified: !!s.phoneVerified, phoneVerifiedAt: s.phoneVerifiedAt || null, phoneVerifyMethod: s.phoneVerifyMethod || '',
    wxid: s.wxid || '', gender: s.gender || '', birthday: s.birthday || '',
    emergencyContact: s.emergencyContact || '', status: s.status, membershipSummary: s.membershipSummary || null,
  };
}

function studentForStaff(s) {
  return { ...studentForSelf(s), groups: s.groups || [], remark: s.remark || '', bound: !!s.userId, createdAt: s.createdAt };
}

/** 教师可见：无手机号、无课时余额等财务信息 */
function studentForTeacher(s) {
  if (!s) return null;
  const sum = s.membershipSummary || {};
  return {
    _id: s._id, name: s.name, avatar: s.avatar || '', gender: s.gender || '', wxid: s.wxid || '',
    emergencyContact: s.emergencyContact || '', remark: s.remark || '', status: s.status,
    membershipLabel: sum.label || '', membershipStatus: sum.status || 'none',
  };
}

function classView(c) {
  return {
    _id: c._id, seriesId: c.seriesId, name: c.name, teacherId: c.teacherId, teacherName: c.teacherName,
    date: c.date, startTime: c.startTime, endTime: c.endTime, duration: c.duration,
    startAt: c.startAt, endAt: c.endAt, capacity: c.capacity || null, description: c.description || '',
    status: c.status, cancelReason: c.cancelReason || '',
  };
}

const LEGACY_TYPE = { pass: 'CLASS_PASS', monthly: 'MONTHLY' };

function membershipView(m) {
  const type = LEGACY_TYPE[m.type] || m.type;
  const mode = type === 'CLASS_PASS' ? 'credits' : (m.policy && m.policy.mode) || 'unlimited';
  return {
    _id: m._id, studentId: m.studentId, type, name: m.name, policyMode: mode, autoExpireDate: m.autoExpireDate || '',
    totalCredits: m.totalCredits || 0, usedCredits: m.usedCredits || 0, remainingCredits: m.remainingCredits || 0,
    purchaseDate: m.purchaseDate, startDate: m.startDate, expireDate: m.expireDate, status: m.status,
    policy: m.policy || null, usage: m.usage || {}, priceCents: m.priceCents || 0, createdAt: m.createdAt,
  };
}

module.exports = { studentForSelf, studentForStaff, studentForTeacher, classView, membershipView };
