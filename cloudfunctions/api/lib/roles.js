'use strict';
/**
 * 多角色模型。users.roles 为角色数组（如 ["owner", "teacher"]），
 * users.role 保存「最高角色」，仅用于排序与兼容旧查询（如统计店主数量）。
 * 权限 = 各角色权限的并集（见 lib/context.js）。
 */
const ROLE_ORDER = ['owner', 'admin', 'teacher', 'student'];
const STAFF_ROLES = ['owner', 'admin', 'teacher'];
const ROLE_LABEL = { owner: '店主', admin: '管理员', teacher: '教师', student: '学员' };

function normalize(list) {
  return ROLE_ORDER.filter((r) => list.includes(r));
}

/** 读取用户角色，兼容迁移前仅有单一 role 字段的旧数据 */
function rolesOf(user) {
  if (!user) return [];
  if (Array.isArray(user.roles)) return normalize(user.roles);
  const list = [];
  if (user.role && ROLE_ORDER.includes(user.role)) list.push(user.role);
  if (user.studentId && !list.includes('student')) list.push('student');
  return normalize(list);
}

/** 生成写入 users 的角色字段 */
function roleFields(list) {
  const roles = normalize(list);
  return { roles, role: roles[0] || 'none' };
}

const isStaff = (roles) => roles.some((r) => STAFF_ROLES.includes(r));
const labelOf = (roles) => roles.map((r) => ROLE_LABEL[r]).join(' · ');

module.exports = { ROLE_ORDER, STAFF_ROLES, ROLE_LABEL, rolesOf, roleFields, isStaff, labelOf };
