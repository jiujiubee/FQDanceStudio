import { call, callWithToast, toastError } from '../../../utils/api'
import { can, ensureRegistered } from '../../../utils/session'

Page({
  data: {
    id: '',
    loading: true,
    cls: {} as any,
    hasRoster: false,
    checkedIn: [] as any[],
    notCheckedIn: [] as any[],
    others: [] as any[],
    stats: { checkedIn: 0, expected: null as number | null, notCheckedIn: null as number | null },
    canMark: false,
    canManage: false,
    modal: { show: false, title: '', content: '', confirmText: '', studentId: '', status: '' },
    picker: false,
    candidates: [] as any[],
  },

  async onLoad(q: Record<string, string>) {
    this.setData({ id: q.id })
  },

  async onShow() {
    const s = await ensureRegistered()
    if (!s) return
    this.setData({ canManage: can('class.manage') })
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    try {
      const r = await call<any>('attendance.classDetail', { classId: this.data.id })
      this.setData({
        loading: false,
        cls: r.class,
        hasRoster: r.hasRoster,
        checkedIn: r.checkedIn,
        notCheckedIn: r.notCheckedIn || [],
        others: r.others,
        stats: r.stats,
        canMark: r.canMark,
      })
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  onMark(e: WechatMiniprogram.CustomEvent) {
    const { id, name, status } = e.detail as { id: string; name: string; status: string }
    const toPresent = status !== 'present'
    if (toPresent && this.data.cls.status === 'cancelled') return
    this.openModal(id, name, toPresent ? 'present' : 'absent')
  },

  openModal(studentId: string, name: string, status: string) {
    this.setData({
      modal: {
        show: true,
        studentId,
        status,
        title: status === 'present' ? '代学员签到' : '更正为缺勤',
        content: status === 'present' ? `为「${name}」手动签到，将按会员规则扣减课时。` : `将「${name}」的签到更正为缺勤，已扣课时将退回。`,
        confirmText: status === 'present' ? '确认签到' : '确认更正',
      },
    })
  },

  closeModal() {
    this.setData({ 'modal.show': false })
  },

  async doMark(e: WechatMiniprogram.CustomEvent) {
    const { studentId, status } = this.data.modal
    this.setData({ 'modal.show': false })
    const r = await callWithToast('attendance.mark', { classId: this.data.id, studentId, status, reason: e.detail.reason }, '提交中')
    if (!r) return
    wx.showToast({ title: '已更新', icon: 'success' })
    this.load()
  },

  rosterCandidates() {
    const rows = [...this.data.notCheckedIn, ...this.data.others]
    const seen = new Set<string>()
    return rows
      .filter((r) => r.status !== 'present' && !seen.has(r.studentId) && seen.add(r.studentId))
      .map((r) => ({ _id: r.studentId, name: r.name, avatar: r.avatar }))
  },

  openPicker() {
    this.setData({ picker: true, candidates: this.rosterCandidates() })
  },

  closePicker() {
    this.setData({ picker: false })
  },

  noop() {},

  async onSearch(e: WechatMiniprogram.CustomEvent) {
    const keyword = e.detail.keyword as string
    if (!keyword) {
      this.setData({ candidates: this.rosterCandidates() })
      return
    }
    try {
      const r = await call<any>('student.search', { keyword, status: 'active' })
      this.setData({ candidates: r.items })
    } catch (err) {
      toastError(err)
    }
  },

  pickStudent(e: WechatMiniprogram.CustomEvent) {
    const s = this.data.candidates.find((c) => c._id === e.detail.id)
    if (!s) return
    if (this.data.checkedIn.some((c) => c.studentId === s._id)) {
      wx.showToast({ title: '该学员已签到', icon: 'none' })
      return
    }
    this.setData({ picker: false })
    this.openModal(s._id, s.name, 'present')
  },

  toRoster() {
    wx.navigateTo({ url: `/pages/admin/roster/index?id=${this.data.id}` })
  },

  toEdit() {
    wx.navigateTo({ url: `/pages/admin/class-form/index?id=${this.data.id}` })
  },
})
