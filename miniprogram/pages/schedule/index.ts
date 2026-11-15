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
  /** 请求序号：预约/取消或新的加载开始时递增，过期响应直接丢弃，避免旧数据覆盖新状态 */
  _seq: 0,
  _mutating: false,

  /** 用后端返回的（数据库确认后的）课程状态替换当前课程 */
  applyClass(item: any) {
    if (!item) return
    const classes = this.data.classes.map((c) => (c._id === item._id ? item : c))
    this.setData({ classes })
    this.filterDay()
  },

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
    // 已有数据时静默刷新（保留当前已确认状态），首次进入显示骨架屏
    this.load(this.data.classes.length > 0)
    // 每分钟刷新一次课程状态
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
    if (this._mutating) return
    const seq = ++this._seq
    if (!silent) this.setData({ loading: true })
    try {
      const r = await call<WeekResult>('schedule.week', { weekStart: this.data.weekStart })
      if (seq !== this._seq) return
      const classes = r.classes.filter((c) => c.status !== 'cancelled')
      this.setData({ classes, marks: r.marks, today: r.today, loading: false })
      this.filterDay()
    } catch (e: any) {
      if (seq !== this._seq) return
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
    this.setData({ weekStart: ws, selected: defaultSelected(ws, this.data.today), classes: [], dayClasses: [] })
    this.load()
  },

  onSelect(e: WechatMiniprogram.CustomEvent) {
    this.setData({ selected: e.detail.date })
    this.filterDay()
  },

  async confirm(title: string, cls: any, confirmText: string): Promise<boolean> {
    return new Promise<boolean>((resolve) =>
      wx.showModal({
        title,
        content: `${cls.name}\n${cls.date} ${cls.startTime} - ${cls.endTime} · ${cls.teacherName}`,
        confirmText,
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      }),
    )
  },

  /** 预约即签到：后端同一事务内扣一次课时；余额以后端返回为准 */
  async onBook(e: WechatMiniprogram.CustomEvent) {
    const id = e.detail.id as string
    if (this.data.busyId) return
    const cls = this.data.classes.find((c) => c._id === id)
    if (!(await this.confirm('确认预约（将扣一次课时）', cls, '预约'))) return
    this.setData({ busyId: id })
    this._mutating = true
    this._seq++
    let ok = false
    try {
      const r = await call<any>('booking.create', { classId: id })
      ok = true
      this.applyClass(r && r.class)
      if (r && r.summary) this.setData({ summary: r.summary })
      wx.showToast({ title: '已预约并签到', icon: 'success' })
      login(true).catch(() => null)
    } catch (err) {
      toastError(err)
    }
    this._mutating = false
    this.setData({ busyId: '' })
    if (!ok) this.load(true)
  },

  async onCancelBook(e: WechatMiniprogram.CustomEvent) {
    const id = e.detail.id as string
    if (this.data.busyId) return
    const cls = this.data.classes.find((c) => c._id === id)
    if (!(await this.confirm('取消预约', cls, '取消预约'))) return
    this.setData({ busyId: id })
    this._mutating = true
    this._seq++
    let ok = false
    try {
      const r = await call<any>('booking.cancel', { classId: id })
      ok = true
      this.applyClass(r && r.class)
      if (r && r.summary) this.setData({ summary: r.summary })
      wx.showToast({ title: r && r.refunded ? '已取消并退还' : '已取消', icon: 'success' })
      login(true).catch(() => null)
    } catch (err) {
      toastError(err)
    }
    this._mutating = false
    this.setData({ busyId: '' })
    if (!ok) this.load(true)
  },

  onOpen(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: `/pages/class-detail/index?id=${e.detail.id}` })
  },

  toMine() {
    wx.switchTab({ url: '/pages/mine/index' })
  },
})
