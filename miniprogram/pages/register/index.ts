import { call, callWithToast, toastError } from '../../utils/api'
import { login } from '../../utils/session'
import { isValidPhone, normalizePhone } from '../../utils/format'

const MODES = [
  { key: 'student', text: '学员注册' },
  { key: 'staff', text: '员工注册' },
]

const ACTIONS: Record<string, { action: string; text: string }> = {
  student: { action: 'auth.registerStudent', text: '注册' },
  staff: { action: 'auth.setupAccount', text: '完成注册' },
}

const SMS_INTERVAL = 60

let timer: any = null

function stopTimer() {
  if (timer) {
	clearInterval(timer)
	timer = null
  }
}

Page({
  data: {
	modes: MODES,
	mode: 'student',
	studioName: '',
	name: '',
	wxid: '',
	// 手机号验证：优先微信官方快捷验证（phoneCode），不可用时改用短信验证码
	phone: '',
	phoneCode: '',
	wxPhoneOk: false,
	smsMode: false,
	smsCode: '',
	countdown: 0,
	agree: false,
	busy: false,
	submitText: '注册',
  },

  async onLoad(q: Record<string, string>) {
	if (q.mode && ACTIONS[q.mode]) this.applyMode(q.mode)
	const s = await login().catch(() => null)
	if (s) this.setData({ studioName: s.studioName, name: s.name || '' })
  },

  onUnload() {
	stopTimer()
  },

  applyMode(mode: string) {
	this.setData({ mode, submitText: ACTIONS[mode].text })
	wx.setNavigationBarTitle({ title: mode === 'staff' ? '员工注册' : '注册' })
  },

  setMode(e: WechatMiniprogram.TouchEvent) {
	this.applyMode(e.currentTarget.dataset.key)
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

  /** 微信官方手机号快速验证：动态令牌交由服务端换取号码，前端不接触明文 */
  onGetPhone(e: any) {
	const code = e.detail && e.detail.code
	if (!code) {
	  wx.showToast({ title: '未完成授权，可改用短信验证', icon: 'none' })
	  this.setData({ smsMode: true })
	  return
	}
	this.setData({ phoneCode: code, wxPhoneOk: true, smsMode: false })
  },

  useSms() {
	this.setData({ smsMode: true, phoneCode: '', wxPhoneOk: false })
  },

  useWx() {
	this.setData({ smsMode: false, smsCode: '' })
  },

  async sendSms() {
	if (this.data.countdown > 0) return
	const phone = normalizePhone(this.data.phone)
	if (!phone) { wx.showToast({ title: '请填写手机号', icon: 'none' }); return }
	if (!isValidPhone(phone)) { wx.showToast({ title: '请输入正确的中国大陆手机号', icon: 'none' }); return }
	try {
	  await call('auth.sendSmsCode', { phone })
	  wx.showToast({ title: '验证码已发送', icon: 'none' })
	  this.setData({ countdown: SMS_INTERVAL })
	  stopTimer()
	  timer = setInterval(() => {
		const n = this.data.countdown - 1
		this.setData({ countdown: n })
		if (n <= 0) stopTimer()
	  }, 1000)
	} catch (e) {
	  toastError(e)
	}
  },

  /** 组装学员手机号凭证；手动输入的号码必须配合短信验证码，不会被视为已验证 */
  phoneCredential(): Record<string, string> | null {
	const { phoneCode, phone, smsCode, smsMode } = this.data
	if (phoneCode && !smsMode) return { phoneCode }
	if (!smsMode) { wx.showToast({ title: '请先验证手机号', icon: 'none' }); return null }
	const p = normalizePhone(phone)
	if (!p) { wx.showToast({ title: '请填写手机号', icon: 'none' }); return null }
	if (!isValidPhone(p)) { wx.showToast({ title: '请输入正确的中国大陆手机号', icon: 'none' }); return null }
	if (!/^\d{6}$/.test(smsCode)) { wx.showToast({ title: '请输入6位短信验证码', icon: 'none' }); return null }
	return { phone: p, smsCode }
  },

  async submit() {
	const { mode, name, wxid, phoneCode, agree } = this.data
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
	if (mode === 'student') {
	  const cred = this.phoneCredential()
	  if (!cred) return
	  Object.assign(payload, cred)
	}

	this.setData({ busy: true })
	const r = await callWithToast<any>(ACTIONS[mode].action, payload, '提交中')
	this.setData({ busy: false })
	if (!r) {
	  // 微信动态令牌仅可使用一次，失败后需重新授权
	  if (phoneCode) this.setData({ phoneCode: '', wxPhoneOk: false })
	  return
	}
	stopTimer()
	const s = await login(true)
	wx.showToast({ title: '完成', icon: 'success' })
	setTimeout(() => {
	  if (mode === 'staff' && !s.isStaff) {
		wx.showModal({ title: '注册完成', content: '请联系店主或管理员，在「员工管理」中搜索你的姓名或微信号并授予角色。', showCancel: false, success: () => wx.reLaunch({ url: '/pages/mine/index' }) })
		return
	  }
	  wx.reLaunch({ url: mode === 'staff' ? '/pages/workbench/index' : '/pages/schedule/index' })
	}, 600)
  },
})
