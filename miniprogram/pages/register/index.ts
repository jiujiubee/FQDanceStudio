import { callWithToast } from '../../utils/api'
import { login } from '../../utils/session'

const SUBMIT_ACTION = 'auth.registerStudent'

Page({
  data: {
	studioName: '',
	name: '',
	wxid: '',
	avatarTmp: '',
	userId: '',
	needPrivacy: false,
	agree: false,
	busy: false,
	submitText: '注册',
  },

  async onLoad() {
	this.checkPrivacy()
	const s = await login().catch(() => null)
	// 已注册用户（同一 OpenID）直接进入，不重复创建账号
	if (s && s.registered) {
	  wx.reLaunch({ url: '/pages/home/index' })
	  return
	}
	if (s) this.setData({ studioName: s.studioName, name: s.name || '', userId: s.userId || '' })
  },

  /** 未同意隐私指引时，按钮先触发同意再执行 chooseAvatar */
  checkPrivacy() {
	const w = wx as any
	if (typeof w.getPrivacySetting !== 'function') return
	w.getPrivacySetting({ success: (r: any) => this.setData({ needPrivacy: !!r.needAuthorization }) })
  },

  onPrivacyAgree() {
	this.setData({ needPrivacy: false })
  },

  onAvatar(e: any) {
	const url = e.detail && e.detail.avatarUrl
	if (url) this.setData({ avatarTmp: url })
  },

  async uploadAvatar(): Promise<string> {
	const tmp = this.data.avatarTmp
	if (!tmp || !this.data.userId) return ''
	try {
	  const ext = (tmp.match(/\.(jpg|jpeg|png|webp)$/i) || ['.jpg'])[0].toLowerCase()
	  const r = await wx.cloud.uploadFile({ cloudPath: `avatars/${this.data.userId}/${Date.now()}${ext}`, filePath: tmp })
	  return r && r.fileID ? r.fileID : ''
	} catch (e) {
	  return ''
	}
  },

  onInput(e: WechatMiniprogram.Input) {
	this.setData({ [e.currentTarget.dataset.k]: e.detail.value })
  },

  toggleAgree() {
	this.setData({ agree: !this.data.agree })
  },

  toPrivacy() {
	wx.navigateTo({ url: '/pages/privacy/index' })
  },

  async submit() {
	const { name, wxid, agree } = this.data
	if (!agree) {
	  wx.showToast({ title: '请先同意隐私政策', icon: 'none' })
	  return
	}
	if (!name.trim()) {
	  wx.showToast({ title: '请输入姓名', icon: 'none' })
	  return
	}
	const payload: Record<string, any> = { agreePrivacy: true, name: name.trim() }
	if (wxid.trim()) payload.wxid = wxid.trim()

	this.setData({ busy: true })
	// 头像上传失败不阻止注册
	const avatar = await this.uploadAvatar()
	if (avatar) payload.avatar = avatar
	const r = await callWithToast<any>(SUBMIT_ACTION, payload, '提交中')
	this.setData({ busy: false })
	if (!r) return
	await login(true)
	wx.showToast({ title: '完成', icon: 'success' })
	setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 600)
  },
})
