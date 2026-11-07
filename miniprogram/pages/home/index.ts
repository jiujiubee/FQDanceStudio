import { call, toastError } from '../../utils/api'
import { ensureRegistered } from '../../utils/session'
import { syncTab } from '../../utils/tab'

Page({
  data: {
    loading: true,
    home: null as any,
  },

  async onShow() {
    syncTab(this, '/pages/home/index')
    const s = await ensureRegistered()
    if (!s) return
    syncTab(this, '/pages/home/index')
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load(): Promise<void> {
    try {
      const home = await call<any>('home.get', {})
      this.setData({ home, loading: false })
      if (home.studioName) wx.setNavigationBarTitle({ title: home.studioName })
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  callPhone() {
    const h = this.data.home
    if (h && h.phone) wx.makePhoneCall({ phoneNumber: h.phone })
  },

  /** 打开地图位置与导航；未设置坐标时提示 */
  openMap() {
    const h = this.data.home
    if (!h || !h.address) return
    if (typeof h.latitude !== 'number' || typeof h.longitude !== 'number') {
      wx.setClipboardData({ data: h.address })
      wx.showToast({ title: '暂未设置地图位置，已复制地址', icon: 'none' })
      return
    }
    wx.openLocation({ latitude: h.latitude, longitude: h.longitude, name: h.studioName || '', address: h.address, scale: 16 })
  },

  openTeacher(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/teacher-detail/index?id=${e.currentTarget.dataset.id}` })
  },

  toSchedule() {
    wx.switchTab({ url: '/pages/schedule/index' })
  },
})
