'use strict';
/**
 * 权限定义与默认权限矩阵。
 * 实际生效矩阵 = rolePermissions 集合中的配置（若存在）否则使用此默认值。
 * owner 永远拥有全部权限（不可配置），防止误操作锁死系统。
 * 角色只有 owner / teacher / student；细粒度权限点保留，可通过矩阵或教师额外权限扩展。
 */
const P = {
  // 学员自助
  SELF_SCHEDULE: 'self.schedule.view',
  SELF_CHECKIN: 'self.checkin',
  SELF_ATTENDANCE: 'self.attendance.view',
  SELF_PROFILE: 'self.profile.edit',
  SELF_MEMBERSHIP: 'self.membership.view',
  // 课程
  CLASS_VIEW_ASSIGNED: 'class.view.assigned',
  CLASS_VIEW_ALL: 'class.view.all',
  CLASS_MANAGE: 'class.manage',
  CLASS_CANCEL: 'class.cancel',
  ROSTER_MANAGE: 'roster.manage',
  // 签到
  ATTENDANCE_VIEW_ASSIGNED: 'attendance.view.assigned',
  ATTENDANCE_VIEW_ALL: 'attendance.view.all',
  ATTENDANCE_MARK: 'attendance.mark',
  // 学员
  STUDENT_VIEW_BASIC: 'student.view.basic',
  STUDENT_VIEW_ALL: 'student.view.all',
  STUDENT_MANAGE: 'student.manage',
  STUDENT_SUSPEND: 'student.suspend',
  // 会员/课时
  MEMBERSHIP_MANAGE: 'membership.manage',
  CREDIT_MANAGE: 'credit.manage',
  TRANSACTION_VIEW: 'transaction.view',
  // 员工
  TEACHER_MANAGE: 'teacher.manage',
  OWNER_MANAGE: 'owner.manage',
  // 系统
  AUDIT_VIEW: 'audit.view',
  SETTINGS_MANAGE: 'settings.manage',
  POLICY_MANAGE: 'policy.manage',
  PERMISSION_MANAGE: 'permission.manage',
};

const ALL = Object.values(P);

const STUDENT_SELF = [P.SELF_SCHEDULE, P.SELF_CHECKIN, P.SELF_ATTENDANCE, P.SELF_PROFILE, P.SELF_MEMBERSHIP];

const DEFAULT_MATRIX = {
  owner: ALL,
  teacher: [
    P.SELF_SCHEDULE, P.SELF_PROFILE,
    P.CLASS_VIEW_ASSIGNED, P.ATTENDANCE_VIEW_ASSIGNED, P.ATTENDANCE_MARK, P.STUDENT_VIEW_BASIC, P.ROSTER_MANAGE,
  ],
  student: STUDENT_SELF,
};

/** 任何配置都不能授予这些角色的权限（硬性安全边界） */
const FORBIDDEN_FOR_ROLE = {
  teacher: [P.OWNER_MANAGE, P.TEACHER_MANAGE, P.PERMISSION_MANAGE, P.CREDIT_MANAGE, P.MEMBERSHIP_MANAGE, P.SETTINGS_MANAGE, P.POLICY_MANAGE, P.TRANSACTION_VIEW],
  student: ALL.filter((p) => !STUDENT_SELF.includes(p)),
};

const { ROLE_ORDER: ROLES, ROLE_LABEL } = require('./roles');
/** 可在权限矩阵中配置的角色（owner 固定拥有全部权限） */
const CONFIGURABLE_ROLES = ['teacher', 'student'];

module.exports = { P, ALL, DEFAULT_MATRIX, FORBIDDEN_FOR_ROLE, ROLES, ROLE_LABEL, CONFIGURABLE_ROLES };
