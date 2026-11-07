'use strict';
/**
 * 多角色模型。users.roles 为角色数组（如 ["owner", "teacher"]），
 * users.role 保存「最高角色」，仅用于排序与兼容旧查询（如统计店主数量）。
 * 权限 = 各角色权限的并集（见 lib/context.js）。
 * 角色体系固定为三级：owner（店主）/ teacher（教师）/ student（学员）。
 * 旧版 admin 角色已废弃：不再是有效角色，读取时被忽略（不产生任何权限），
 * 迁移见 services/system.js 的 system.migrate。
 */
const ROLE_ORDER = ['owner', 'teacher', 'student'];
const STAFF_ROLES = ['owner', 'teacher'];
const ROLE_LABEL = { owner: '店主', teacher: '教师', student: '学员' };
/** 已废弃的旧角色（仅用于数据迁移识别，不授予任何权限） */
const LEGACY_ROLES = ['admin'];

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

/** 是否带有已废弃的 admin 角色（迁移前的旧数据） */
function hasLegacyAdmin(user) {
  if (!user) return false;
  if (Array.isArray(user.roles) && user.roles.includes('admin')) return true;
  return user.role === 'admin';
}

module.exports = { ROLE_ORDER, STAFF_ROLES, ROLE_LABEL, LEGACY_ROLES, hasLegacyAdmin, rolesOf, roleFields, isStaff, labelOf };
