import { call, callWithToast, toastError } from '../../../utils/api'
import { can, ensureRegistered } from '../../../utils/session'
import { addDays, daysInMonth, today } from '../../../utils/date'

Page({
  data: {
    month: today().slice(0, 7),
    date: today(),
    marks: {} as Record<string, number>,
    classes: [] as any[],
    dayClasses: [] as any[],
    loading: true,
    canManage: false,
    canCancel: false,
    modal: { show: false, title: '', content: '', classId: '', seriesId: '' },
  },

  async onShow() {
    const s = await ensureRegistered()
    if (!s) return
    this.setData({ canManage: can('class.manage'), canCancel: can('class.cancel') })
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    this.setData({ loading: true })
    const m = this.data.month
    // 覆盖月历显示的 6 周范围
    const from = addDays(`${m}-01`, -7)
    const to = addDays(`${m}-${String(daysInMonth(m)).padStart(2, '0')}`, 14)
    try {
      const r = await call<any>('class.list', { from, to })
      this.setData({ classes: r.classes, marks: r.marks, loading: false })
      this.filter()
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  filter() {
    this.setData({ dayClasses: this.data.classes.filter((c) => c.date === this.data.date) })
  },

  onMonth(e: WechatMiniprogram.CustomEvent) {
    this.setData({ month: e.detail.month })
    this.load()
  },

  onSelect(e: WechatMiniprogram.CustomEvent) {
    const date = e.detail.date as string
    this.setData({ date })
    if (date.slice(0, 7) !== this.data.month) {
      this.setData({ month: date.slice(0, 7) })
      this.load()
    } else this.filter()
  },

  create() {
    wx.navigateTo({ url: `/pages/admin/class-form/index?date=${this.data.date}` })
  },

  open(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: `/pages/teacher/class/index?id=${e.detail.id}` })
  },

  edit(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/admin/class-form/index?id=${e.currentTarget.dataset.id}` })
  },

  roster(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/admin/roster/index?id=${e.currentTarget.dataset.id}` })
  },

  askCancel(e: WechatMiniprogram.TouchEvent) {
    const c = this.data.classes.find((x) => x._id === e.currentTarget.dataset.id)
    this.setData({
      modal: { show: true, title: '取消本节课程', content: `${c.name} ${c.date} ${c.startTime}\n已签到学员将按退课规则处理，出勤记录保留。`, classId: c._id, seriesId: '' },
    })
  },

  askCancelSeries(e: WechatMiniprogram.TouchEvent) {
    this.setData({
      modal: { show: true, title: '取消整批课程', content: '将取消该批次中所有尚未结束的课程，已结束课程及记录不受影响。', classId: '', seriesId: e.currentTarget.dataset.sid },
    })
  },

  closeModal() {
    this.setData({ 'modal.show': false })
  },

  async doCancel(e: WechatMiniprogram.CustomEvent) {
    const { classId, seriesId } = this.data.modal
    this.setData({ 'modal.show': false })
    const reason = e.detail.reason
    const r = classId
      ? await callWithToast<any>('class.cancel', { classId, reason }, '处理中')
      : await callWithToast<any>('class.cancelSeries', { seriesId, reason }, '处理中')
    if (!r) return
    const msg = classId
      ? `已取消${r.refunded ? `，退还 ${r.refunded} 名学员课时` : ''}`
      : `已取消 ${r.cancelled} 节${r.refunded ? `，退还 ${r.refunded} 人次课时` : ''}`
    wx.showModal({ title: '完成', content: msg, showCancel: false })
    this.load()
  },
})
