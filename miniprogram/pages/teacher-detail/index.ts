import { call, toastError } from '../../utils/api'

Page({
  data: {
    loading: true,
    t: null as any,
  },

  async onLoad(q: Record<string, string | undefined>) {
    try {
      const t = await call<any>('teacher.publicGet', { teacherId: q.id })
      this.setData({ t, loading: false })
      wx.setNavigationBarTitle({ title: t.name || '导师' })
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  preview(e: WechatMiniprogram.TouchEvent) {
    const photos = (this.data.t && this.data.t.photos) || []
    wx.previewImage({ urls: photos, current: e.currentTarget.dataset.src })
  },
})
