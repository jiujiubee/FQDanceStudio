import { call, toastError } from '../../utils/api'
import { LOCAL_AVATAR } from '../../utils/image'

Page({
  data: {
    loading: true,
    t: null as any,
    avatarSrc: LOCAL_AVATAR,
  },

  async onLoad(q: Record<string, string | undefined>) {
    try {
      const t = await call<any>('teacher.publicGet', { teacherId: q.id })
      this.setData({ t, avatarSrc: t.avatarUrl || LOCAL_AVATAR, loading: false })
      wx.setNavigationBarTitle({ title: t.name || '导师' })
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  onAvatarError() {
    this.setData({ avatarSrc: LOCAL_AVATAR })
  },

  preview(e: WechatMiniprogram.TouchEvent) {
    const photos = (this.data.t && this.data.t.photoUrls) || []
    wx.previewImage({ urls: photos, current: e.currentTarget.dataset.src })
  },
})
