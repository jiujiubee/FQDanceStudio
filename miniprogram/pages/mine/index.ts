import { call } from '../../utils/api'
import { DEV_MODE } from '../../config'
import { ensureRegistered, isStaff, login } from '../../utils/session'
import { syncTab } from '../../utils/tab'

Page({
  data: {
    name: '',
    avatar: '',
    roleLabel: '',
    studioName: '',
    student: null as any,
    isStaff: false,
    devMode: DEV_MODE,
    memberships: [] as any[],
    loadingMs: true,
  },

  async onShow() {
    syncTab(this, '/pages/mine/index')
    const s0 = await ensureRegistered()
    if (!s0) return
    const s = await login(true).catch(() => s0)
    syncTab(this, '/pages/mine/index')
    this.setData({
      name: s.name || '',
      avatar: (s.student && s.student.avatar) || (s.teacher && s.teacher.avatar) || '',
      roleLabel: s.roleLabel || '',
      studioName: s.studioName,
      student: s.student || null,
      isStaff: isStaff(),
    })
    if (s.student) {
      try {
        const r = await call<{ memberships: any[] }>('membership.mine')
        this.setData({ memberships: r.memberships, loadingMs: false })
      } catch (e) {
        this.setData({ loadingMs: false })
      }
    }
  },

  toProfile() {
    wx.navigateTo({ url: '/pages/profile/index' })
  },
  toPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' })
  },
  toStaffJoin() {
    wx.showModal({
      title: '成为员工',
      content: '无需邀请码。请将你的姓名或微信号告知店主/管理员，由对方在「员工管理」中搜索并授予角色，重新进入小程序即可生效。',
      showCancel: false,
    })
  },
  toDev() {
    wx.navigateTo({ url: '/pages/dev/index' })
  },
})
