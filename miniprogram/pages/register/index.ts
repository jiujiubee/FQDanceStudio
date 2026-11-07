import { callWithToast } from '../../utils/api'
import { login } from '../../utils/session'
import { isValidPhone, normalizePhone } from '../../utils/format'

const SUBMIT_ACTION = 'auth.registerStudent'

Page({
  data: {
	studioName: '',
	name: '',
	wxid: '',
	// 手机号为选填资料，无需短信/微信验证
	phone: '',
	agree: false,
	busy: false,
	submitText: '注册',
  },

  async onLoad() {
	const s = await login().catch(() => null)
	// 已注册用户（同一 OpenID）直接进入，不重复创建账号
	if (s && s.registered) {
	  wx.reLaunch({ url: '/pages/home/index' })
	  return
	}
	if (s) this.setData({ studioName: s.studioName, name: s.name || '' })
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
	const { name, wxid, phone, agree } = this.data
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
	const p = normalizePhone(phone)
	if (p) {
	  if (!isValidPhone(p)) { wx.showToast({ title: '手机号格式不正确，可留空', icon: 'none' }); return }
	  payload.phone = p
	}

	this.setData({ busy: true })
	const r = await callWithToast<any>(SUBMIT_ACTION, payload, '提交中')
	this.setData({ busy: false })
	if (!r) return
	await login(true)
	wx.showToast({ title: '完成', icon: 'success' })
	setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 600)
  },
})
