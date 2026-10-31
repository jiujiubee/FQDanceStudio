import { call, toastError } from '../../../utils/api'
import { ensureRegistered } from '../../../utils/session'

const ACTIONS: Record<string, string> = {
  'owner.bootstrap': '系统初始化',
  'invite.create': '生成邀请码',
  'invite.redeem': '使用邀请码',
  'staff.setRole': '变更员工角色',
  'staff.setTeaching': '变更授课资格',
  'role.grant': '授予角色',
  'role.revoke': '撤销角色',
  'teacher.permissions': '调整教师权限',
  'class.create': '创建排课',
  'class.update': '编辑课程',
  'class.cancel': '取消课程',
  'series.cancel': '取消排课批次',
  'roster.set': '设置上课名单',
  'attendance.mark': '手动签到/更正',
  'student.create': '登记学员',
  'student.update': '编辑学员',
  'student.status': '变更学员状态',
  'membership.create': '开卡',
  'membership.adjust': '调整课时',
  'membership.renew': '续费',
  'membership.status': '变更会员卡状态',
  'settings.update': '修改系统设置',
  'permissions.update': '修改权限',
  'permissions.reset': '重置权限',
  'account.delete': '注销账户',
  'maintenance.daily': '每日维护',
}

function brief(v: any): string {
  if (v === null || v === undefined) return '—'
  const s = JSON.stringify(v)
  return s.length > 120 ? s.slice(0, 120) + '…' : s
}

Page({
  data: { items: [] as any[], page: 0, hasMore: false, loading: true },

  async onLoad() {
    const s = await ensureRegistered()
    if (s) this.fetch(0)
  },

  async onPullDownRefresh() {
    await this.fetch(0)
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.fetch(this.data.page + 1)
  },

  async fetch(page: number) {
    this.setData({ loading: true })
    try {
      const r = await call<any>('audit.list', { page })
      const items = r.items.map((l: any) => ({
        ...l,
        actionText: ACTIONS[l.action] || l.action,
        diff: l.before || l.after ? `${brief(l.before)} → ${brief(l.after)}` : '',
      }))
      this.setData({ items: page ? this.data.items.concat(items) : items, hasMore: r.hasMore, page, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },
})
