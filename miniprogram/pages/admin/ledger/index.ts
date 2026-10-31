import { call, toastError } from '../../../utils/api'
import { ensureRegistered } from '../../../utils/session'

Page({
  data: {
    studentId: '',
    name: '',
    types: [
      { key: '', text: '全部' },
      { key: 'purchase', text: '购买开卡' },
      { key: 'attendance_deduction', text: '签到扣课' },
      { key: 'credit_add', text: '增加课时' },
      { key: 'manual_deduction', text: '手动扣课' },
      { key: 'refund', text: '退还' },
      { key: 'renewal', text: '续费' },
      { key: 'expiration', text: '到期' },
    ],
    type: '',
    items: [] as any[],
    page: 0,
    hasMore: false,
    loading: true,
  },

  async onLoad(q: Record<string, string>) {
    this.setData({ studentId: q.studentId || '', name: q.name ? decodeURIComponent(q.name) : '' })
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

  setType(e: WechatMiniprogram.TouchEvent) {
    this.setData({ type: e.currentTarget.dataset.k, items: [] })
    this.fetch(0)
  },

  async fetch(page: number) {
    this.setData({ loading: true })
    try {
      const params: Record<string, any> = { page }
      if (this.data.studentId) params.studentId = this.data.studentId
      if (this.data.type) params.type = this.data.type
      const r = await call<any>('transaction.list', params)
      this.setData({ items: page ? this.data.items.concat(r.items) : r.items, hasMore: r.hasMore, page, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },
})
