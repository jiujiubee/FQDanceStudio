import { call, callWithToast, getDevAs, toastError } from '../../utils/api'
import { DEV_MODE } from '../../config'
import { login } from '../../utils/session'

Page({
  data: { enabled: DEV_MODE, identities: [] as any[], current: '' },

  onShow() {
    if (!DEV_MODE) return
    this.load()
  },

  async load() {
    try {
      const r = await call<{ identities: any[]; current: string }>('dev.identities')
      this.setData({ identities: r.identities, current: getDevAs() })
    } catch (e) {
      toastError(e)
    }
  },

  async switchTo(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string
    if (key) wx.setStorageSync('devAs', key)
    else wx.removeStorageSync('devAs')
    await login(true).catch(() => null)
    wx.reLaunch({ url: '/pages/mine/index' })
  },

  async seed() {
    const r = await callWithToast<any>('dev.seed', {}, '生成中')
    if (r) {
      wx.showToast({ title: `新增${r.accounts.length}个账户`, icon: 'none' })
      this.load()
    }
  },

  reset() {
    wx.showModal({
      title: '重置开发环境',
      content: '将清空开发环境数据库全部数据并重新生成测试数据，确定？',
      confirmColor: '#722F3E',
      success: async (res) => {
        if (!res.confirm) return
        const r = await callWithToast<any>('dev.reset', { confirm: true }, '重置中')
        if (r) {
          wx.removeStorageSync('devAs')
          await login(true).catch(() => null)
          this.load()
        }
      },
    })
  },
})
