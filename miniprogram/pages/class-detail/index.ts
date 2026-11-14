import { call, toastError } from '../../utils/api'
import { ensureRegistered, login } from '../../utils/session'

/** 请求序号：过期的加载响应不覆盖更新的状态 */
let _seq = 0

Page({
  data: {
    id: '',
    loading: true,
    cls: null as any,
    busy: false,
  },

  onLoad(q: Record<string, string>) {
    this.setData({ id: q.id })
  },

  async onShow() {
    const s = await ensureRegistered()
    if (!s) return
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load(): Promise<void> {
    const seq = ++_seq
    try {
      const r = await call<any>('schedule.classDetail', { classId: this.data.id })
      if (seq !== _seq || this.data.busy) return
      this.setData({ cls: r.class, loading: false })
    } catch (e) {
      if (seq !== _seq) return
      this.setData({ loading: false })
      toastError(e)
    }
  },

  confirm(title: string, confirmText: string): Promise<boolean> {
    const c = this.data.cls
    return new Promise<boolean>((resolve) =>
      wx.showModal({
        title,
        content: `${c.name}\n${c.date} ${c.startTime} - ${c.endTime} · ${c.teacherName}`,
        confirmText,
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      }),
    )
  },

  async run(action: string, title: string, confirmText: string, done: string) {
    if (this.data.busy || !(await this.confirm(title, confirmText))) return
    this.setData({ busy: true })
    _seq++
    try {
      const r = await call<any>(action, { classId: this.data.id })
      // 立即使用后端（数据库确认后）返回的课程状态，避免旧状态回显
      if (r && r.class) this.setData({ cls: { ...r.class, videoUrl: r.class.videoUrl || (this.data.cls && this.data.cls.videoUrl) || '' } })
      wx.showToast({ title: action === 'booking.cancel' && r && !r.refunded ? '已取消' : done, icon: 'success' })
      login(true).catch(() => null)
      this.setData({ busy: false })
    } catch (err) {
      toastError(err)
      this.setData({ busy: false })
      this.load()
    }
  },

  /** 预约即签到，立即扣一次课时；取消截止时间由系统设置 bookingCancellationCutoffMinutes 决定 */
  book() {
    this.run('booking.create', '确认预约（将扣一次课时）', '预约', '已预约并扣除课时')
  },

  cancelBook() {
    this.run('booking.cancel', '取消预约（退还课时）', '取消预约', '已取消并退还课时')
  },

  onVideoError() {
    wx.showToast({ title: '视频加载失败，请下拉刷新', icon: 'none' })
  },

  openTeacher() {
    const c = this.data.cls
    if (c && c.teacherId) wx.navigateTo({ url: `/pages/teacher-detail/index?id=${c.teacherId}` })
  },
})
