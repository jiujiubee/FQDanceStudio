import { dateCN, dateTimeCN, durationCN, toTime } from './date'

export const ATTENDANCE_STATUS: Record<string, string> = {
  present: '已签到',
  absent: '缺勤',
  class_cancelled: '课程取消',
  pending: '未签到',
}

export const MEMBERSHIP_TYPE: Record<string, string> = {
  CLASS_PASS: '次卡',
  MONTHLY: '月卡',
  QUARTERLY: '季卡',
  pass: '次卡',
  monthly: '月卡',
  none: '未开卡',
}

export const POLICY_MODE: Record<string, string> = {
  credits: '按次扣减',
  unlimited: '不限次数',
  quota: '有效期内固定次数',
  limited: '每月限次',
}

/** 中国大陆手机号（与后端 lib/phone.js 规则一致） */
export const PHONE_RE = /^1[3-9]\d{9}$/

export function normalizePhone(raw: string): string {
  return String(raw || '').replace(/[\s-]/g, '').replace(/^(\+?86)(?=1\d{10}$)/, '')
}

export function isValidPhone(raw: string): boolean {
  return PHONE_RE.test(normalizePhone(raw))
}

export const MEMBERSHIP_STATUS: Record<string, string> = {
  active: '有效',
  expired: '已过期',
  suspended: '已冻结',
  none: '未开卡',
}

export const TX_TYPE: Record<string, string> = {
  purchase: '购买开卡',
  credit_add: '增加课时',
  attendance_deduction: '签到扣课',
  manual_deduction: '手动扣课',
  refund: '退还课时',
  renewal: '续费',
  expiration: '到期失效',
  status_change: '状态变更',
}

export const ROLE_LABEL: Record<string, string> = {
  owner: '店主',
  admin: '管理员',
  teacher: '教师',
  student: '学员',
}

export function yuan(cents: number): string {
  return '¥' + (cents / 100).toFixed(2)
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

/** 为课程对象补充展示字段 */
export function decorateClass<T extends Record<string, any>>(c: T): T & { dateText: string; durationText: string; timeText: string } {
  return {
    ...c,
    dateText: dateCN(c.date),
    durationText: durationCN(c.duration),
    timeText: `${c.startTime} - ${c.endTime}`,
  }
}

export function checkInText(ms: number | null | undefined): string {
  return ms ? toTime(ms) : '—'
}

export { dateCN, dateTimeCN, durationCN }
