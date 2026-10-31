import { call, toastError } from '../../utils/api'
import { can, ensureRegistered, isStaff } from '../../utils/session'
import { addDays, today as todayStr, weekStart as getWeekStart } from '../../utils/date'
import { syncTab } from '../../utils/tab'

interface Menu { text: string; icon: string; url: string; perm: string[] }

const MENUS: Menu[] = [
  { text: '排课管理', icon: 'calendar', url: '/pages/admin/classes/index', perm: ['class.manage', 'class.view.all'] },
  { text: '学员管理', icon: 'users', url: '/pages/admin/students/index', perm: ['student.view.all', 'student.view.basic'] },
  { text: '课时流水', icon: 'ledger', url: '/pages/admin/ledger/index', perm: ['transaction.view'] },
  { text: '员工管理', icon: 'teacher', url: '/pages/admin/staff/index', perm: ['teacher.manage', 'admin.manage'] },
  { text: '系统设置', icon: 'settings', url: '/pages/admin/settings/index', perm: ['settings.manage', 'policy.manage', 'permission.manage'] },
  { text: '操作日志', icon: 'list', url: '/pages/admin/audit/index', perm: ['audit.view'] },
]

function greet(): string {
  const h = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours()
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

Page({
  data: {
    name: '',
    roleLabel: '',
    greeting: '',
    today: '',
    date: '',
    weekStart: '',
    marks: {} as Record<string, number>,
    scope: 'all',
    canAll: false,
    classes: [] as any[],
    totals: { classes: 0, checkedIn: 0, expected: 0, notCheckedIn: 0 },
    loading: true,
    menus: [] as Menu[],
  },

  async onShow() {
    syncTab(this, '/pages/workbench/index')
    const s = await ensureRegistered()
    if (!s) return
    syncTab(this, '/pages/workbench/index')
    if (!isStaff()) {
      wx.switchTab({ url: '/pages/schedule/index' })
      return
    }
    const t = todayStr()
    const canAll = can('attendance.view.all') || can('class.view.all')
    this.setData({
      name: s.name || '',
      roleLabel: s.roleLabel || '',
      greeting: greet(),
      today: t,
      date: this.data.date || t,
      weekStart: this.data.weekStart || getWeekStart(t),
      canAll,
      scope: canAll ? this.data.scope : 'mine',
      menus: MENUS.filter((m) => m.perm.some((p) => can(p))),
    })
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const ws = this.data.weekStart
      const [d, l] = await Promise.all([
        call<any>('teacher.dashboard', { date: this.data.date, scope: this.data.scope }),
        call<any>('class.list', { from: ws, to: addDays(ws, 6) }),
      ])
      this.setData({ classes: d.classes, totals: d.totals, marks: l.marks, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  onWeek(e: WechatMiniprogram.CustomEvent) {
    const ws = e.detail.weekStart as string
    const t = this.data.today
    this.setData({ weekStart: ws, date: ws === getWeekStart(t) ? t : ws })
    this.load()
  },

  onSelect(e: WechatMiniprogram.CustomEvent) {
    this.setData({ date: e.detail.date })
    this.load()
  },

  setScope(e: WechatMiniprogram.TouchEvent) {
    this.setData({ scope: e.currentTarget.dataset.s })
    this.load()
  },

  openClass(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: `/pages/teacher/class/index?id=${e.detail.id}` })
  },

  go(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  },
})
