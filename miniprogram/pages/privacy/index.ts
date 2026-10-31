import { callWithToast } from '../../utils/api'
import { clearSession, login } from '../../utils/session'
import { PRIVACY_CONTACT } from '../../config'

Page({
  data: { version: '', studioName: '', registered: false, contact: PRIVACY_CONTACT, showDelete: false },

  async onLoad() {
    const s = await login().catch(() => null)
    if (s) this.setData({ version: s.privacyPolicyVersion, studioName: s.studioName, registered: s.registered })
  },

  async exportData() {
    const r = await callWithToast('profile.export', {}, '生成中')
    if (!r) return
    const text = JSON.stringify(r, null, 2)
    wx.setClipboardData({
      data: text,
      success: () => wx.showModal({ title: '已复制', content: '个人信息副本（JSON）已复制到剪贴板，可粘贴保存。', showCancel: false }),
    })
  },

  askDelete() {
    this.setData({ showDelete: true })
  },

  closeDelete() {
    this.setData({ showDelete: false })
  },

  async doDelete() {
    this.setData({ showDelete: false })
    const r = await callWithToast('profile.deleteAccount', { confirm: true }, '处理中')
    if (!r) return
    clearSession()
    wx.showToast({ title: '账户已注销', icon: 'success' })
    setTimeout(() => wx.reLaunch({ url: '/pages/register/index' }), 800)
  },
})
