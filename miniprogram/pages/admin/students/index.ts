import { call, toastError } from '../../../utils/api'
import { can, ensureRegistered } from '../../../utils/session'

Page({
  data: { keyword: '', status: 'all', items: [] as any[], page: 0, hasMore: false, loading: true, canManage: false },

  async onShow() {
    const s = await ensureRegistered()
    if (!s) return
    this.setData({ canManage: can('student.manage') })
    this.reload()
  },

  async onPullDownRefresh() {
    await this.reload()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.fetch(this.data.page + 1)
  },

  reload() {
    this.setData({ page: 0 })
    return this.fetch(0)
  },

  async fetch(page: number) {
    this.setData({ loading: true })
    try {
      const r = await call<any>('student.search', { keyword: this.data.keyword, status: this.data.status, page })
      this.setData({ items: page ? this.data.items.concat(r.items) : r.items, hasMore: r.hasMore, page, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  onSearch(e: WechatMiniprogram.CustomEvent) {
    this.setData({ keyword: e.detail.keyword })
    this.reload()
  },

  setStatus(e: WechatMiniprogram.TouchEvent) {
    this.setData({ status: e.currentTarget.dataset.s })
    this.reload()
  },

  open(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: `/pages/admin/student/index?id=${e.detail.id}` })
  },

  create() {
    wx.navigateTo({ url: '/pages/admin/student-form/index' })
  },
})
