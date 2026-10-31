import { call, toastError } from '../../utils/api'
import { ensureRegistered } from '../../utils/session'
import { addDays, today } from '../../utils/date'
import { syncTab } from '../../utils/tab'

Page({
  data: {
    ranges: [
      { key: 'all', text: '全部' },
      { key: 'week', text: '本周' },
      { key: 'month', text: '本月' },
      { key: 'custom', text: '自定义' },
    ],
    range: 'all',
    from: addDays(today(), -30),
    to: today(),
    items: [] as any[],
    page: 0,
    hasMore: false,
    loading: true,
  },

  async onShow() {
    syncTab(this, '/pages/history/index')
    const s = await ensureRegistered()
    if (!s) return
    syncTab(this, '/pages/history/index')
    if (!s.student) {
      this.setData({ loading: false, items: [] })
      return
    }
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
    this.setData({ loading: true, items: [], page: 0 })
    return this.fetch(0)
  },

  async fetch(page: number) {
    try {
      const params: Record<string, any> = { range: this.data.range, page }
      if (this.data.range === 'custom') Object.assign(params, { from: this.data.from, to: this.data.to })
      const r = await call<{ items: any[]; hasMore: boolean }>('attendance.myHistory', params)
      this.setData({ items: page ? this.data.items.concat(r.items) : r.items, hasMore: r.hasMore, page, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  setRange(e: WechatMiniprogram.TouchEvent) {
    this.setData({ range: e.currentTarget.dataset.key })
    this.reload()
  },

  onFrom(e: WechatMiniprogram.PickerChange) {
    this.setData({ from: e.detail.value as string })
    this.reload()
  },

  onTo(e: WechatMiniprogram.PickerChange) {
    this.setData({ to: e.detail.value as string })
    this.reload()
  },
})
