import { call } from '../../utils/api'
import { DEV_MODE } from '../../config'
import { ensureRegistered, isStaff, isStudentPreview, login, setStudentPreview } from '../../utils/session'
import { syncTab } from '../../utils/tab'

Page({
  data: {
    name: '',
    avatar: '',
    roleLabel: '',
    studioName: '',
    student: null as any,
    isStaff: false,
    preview: false,
    devMode: DEV_MODE,
    memberships: [] as any[],
    loadingMs: true,
    loading: true,
    error: '',
  },

  async onShow() {
    syncTab(this, '/pages/mine/index')
    this.load()
  },

  retry() {
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    const s0 = await ensureRegistered()
    if (!s0) { this.setData({ loading: false, error: '登录状态获取失败' }); return }
    let s: any
    try {
      s = await login(true)
    } catch (e: any) {
      this.setData({ loading: false, error: (e && e.message) || '个人资料加载失败' })
      return
    }
    if (!s || !s.registered) {
      this.setData({ loading: false, error: '个人资料加载失败，请重试' })
      return
    }
    syncTab(this, '/pages/mine/index')
    this.setData({
      loading: false,
      name: s.name || '',
      avatar: (s.student && s.student.avatar) || (s.teacher && s.teacher.avatar) || '',
      roleLabel: s.roleLabel || '',
      studioName: s.studioName,
      student: s.student || null,
      isStaff: isStaff(),
      preview: isStudentPreview(),
      memberships: [],
      loadingMs: !!s.student,
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
  toDev() {
    wx.navigateTo({ url: '/pages/dev/index' })
  },
  /** 切换学生端预览：只改变界面，不改变真实角色与后端权限 */
  togglePreview() {
    const on = !this.data.preview
    setStudentPreview(on)
    this.setData({ preview: isStudentPreview() })
    wx.showToast({ title: on ? '已进入学生端预览' : '已退出预览', icon: 'none' })
    wx.reLaunch({ url: on ? '/pages/home/index' : '/pages/workbench/index' })
  },
})
