import { call, toastError } from '../../utils/api'
import { ensureRegistered, login } from '../../utils/session'
import { defaultSelected, today as todayStr, weekStart as getWeekStart } from '../../utils/date'
import { syncTab } from '../../utils/tab'

interface WeekResult {
  weekStart: string
  today: string
  serverNow: number
  classes: any[]
  marks: Record<string, number>
}

Page({
  data: {
    studioName: '',
    today: '',
    weekStart: '',
    selected: '',
    marks: {} as Record<string, number>,
    classes: [] as any[],
    dayClasses: [] as any[],
    loading: true,
    busyId: '',
    summary: null as any,
  },

  _timer: 0 as any,

  async onShow() {
    syncTab(this, '/pages/schedule/index')
    const s = await ensureRegistered()
    if (!s) return
    syncTab(this, '/pages/schedule/index')
    const t = todayStr()
    const ws = this.data.weekStart && this.data.weekStart >= getWeekStart(t) ? this.data.weekStart : getWeekStart(t)
    this.setData({
      studioName: s.studioName,
      today: t,
      weekStart: ws,
      selected: this.data.selected && this.data.selected >= ws ? this.data.selected : defaultSelected(ws, t),
      summary: s.student ? s.student.membershipSummary : null,
    })
    this.load()
    // 每分钟刷新一次签到可用状态
    clearInterval(this._timer)
    this._timer = setInterval(() => this.load(true), 60000)
  },

  onHide() {
    clearInterval(this._timer)
  },

  onUnload() {
    clearInterval(this._timer)
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load(silent?: boolean): Promise<void> {
    if (!silent) this.setData({ loading: true })
    try {
      const r = await call<WeekResult>('schedule.week', { weekStart: this.data.weekStart })
      this.setData({ classes: r.classes, marks: r.marks, today: r.today, loading: false })
      this.filterDay()
    } catch (e: any) {
      this.setData({ loading: false })
      if (e && e.code === 'PAST_WEEK') {
        this.setData({ weekStart: getWeekStart(todayStr()) })
        return this.load()
      }
      if (!silent) toastError(e)
    }
  },

  filterDay() {
    this.setData({ dayClasses: this.data.classes.filter((c) => c.date === this.data.selected) })
  },

  onWeek(e: WechatMiniprogram.CustomEvent) {
    const ws = e.detail.weekStart as string
    this.setData({ weekStart: ws, selected: defaultSelected(ws, this.data.today) })
    this.load()
  },

  onSelect(e: WechatMiniprogram.CustomEvent) {
    this.setData({ selected: e.detail.date })
    this.filterDay()
  },

  async onCheckIn(e: WechatMiniprogram.CustomEvent) {
    const id = e.detail.id as string
    if (this.data.busyId) return
    const cls = this.data.classes.find((c) => c._id === id)
    const ok = await new Promise<boolean>((resolve) =>
      wx.showModal({
        title: '确认签到',
        content: `${cls.name}\n${cls.startTime} - ${cls.endTime} · ${cls.teacherName}`,
        confirmText: '签到',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      }),
    )
    if (!ok) return
    this.setData({ busyId: id })
    try {
      await call('attendance.checkIn', { classId: id })
      wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: '签到成功', icon: 'success' })
      login(true).then((ns) => this.setData({ summary: ns.student ? ns.student.membershipSummary : null })).catch(() => null)
    } catch (err) {
      toastError(err)
    }
    this.setData({ busyId: '' })
    this.load(true)
  },

  toMine() {
    wx.switchTab({ url: '/pages/mine/index' })
  },
})
