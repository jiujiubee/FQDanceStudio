import { callWithToast } from '../../utils/api'
import { login } from '../../utils/session'
import { isValidPhone, normalizePhone } from '../../utils/format'
import { LOCAL_LOGO } from '../../utils/image'

const SUBMIT_ACTION = 'auth.registerStudent'

Page({
  data: {
	studioName: '',
	name: '',
	phone: '',
	defaultAvatar: LOCAL_LOGO,
	avatarTmp: '',
	avatarFileID: '',
	userId: '',
	agree: false,
	busy: false,
	uploading: false,
	submitText: '注册',
  },

  async onLoad() {
	const s: any = await login().catch(() => null)
	// 已注册用户（同一 OpenID）直接进入，不重复创建账号
	if (s && s.registered) {
	  wx.reLaunch({ url: '/pages/home/index' })
	  return
	}
	if (s) this.setData({ studioName: s.studioName, userId: s.userId || '', defaultAvatar: s.defaultAvatar || LOCAL_LOGO })
  },

  onDefaultAvatarError() {
	this.setData({ defaultAvatar: LOCAL_LOGO })
  },

  /** 从相册/相机选择图片并立即上传到 CloudBase，成功后替换默认头像 */
  chooseAvatar() {
	if (this.data.uploading) return
	wx.chooseMedia({
	  count: 1,
	  mediaType: ['image'],
	  sizeType: ['compressed'],
	  success: (r) => {
		const f = r.tempFiles && r.tempFiles[0]
		if (f && f.tempFilePath) this.uploadAvatar(f.tempFilePath)
	  },
	})
  },

  async uploadAvatar(tmp: string) {
	if (!this.data.userId) {
	  wx.showToast({ title: '登录状态无效，请重新进入', icon: 'none' })
	  return
	}
	this.setData({ uploading: true })
	wx.showLoading({ title: '上传中', mask: true })
	try {
	  const ext = (tmp.match(/\.(jpg|jpeg|png|webp)$/i) || ['.jpg'])[0].toLowerCase()
	  const r = await wx.cloud.uploadFile({ cloudPath: `avatars/${this.data.userId}/${Date.now()}${ext}`, filePath: tmp })
	  if (!r || !r.fileID || r.fileID.indexOf('cloud://') !== 0) throw new Error('no fileID')
	  this.setData({ avatarTmp: tmp, avatarFileID: r.fileID })
	  wx.hideLoading()
	} catch (e) {
	  wx.hideLoading()
	  wx.showToast({ title: '头像上传失败，请重试', icon: 'none' })
	}
	this.setData({ uploading: false })
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
	const { name, agree, avatarFileID, uploading } = this.data
	const phone = normalizePhone(this.data.phone)
	if (!agree) {
	  wx.showToast({ title: '请先同意隐私政策', icon: 'none' })
	  return
	}
	if (!name.trim()) {
	  wx.showToast({ title: '请输入真实姓名', icon: 'none' })
	  return
	}
	if (!phone) {
	  wx.showToast({ title: '请输入手机号', icon: 'none' })
	  return
	}
	if (!isValidPhone(phone)) {
	  wx.showToast({ title: '请输入正确的中国大陆手机号', icon: 'none' })
	  return
	}
	if (uploading) {
	  wx.showToast({ title: '头像上传中，请稍候', icon: 'none' })
	  return
	}
	const payload: Record<string, any> = { agreePrivacy: true, name: name.trim(), phone }
	if (avatarFileID) payload.avatar = avatarFileID

	this.setData({ busy: true })
	const r = await callWithToast<any>(SUBMIT_ACTION, payload, '提交中')
	this.setData({ busy: false })
	if (!r) return
	await login(true)
	wx.showToast({ title: '完成', icon: 'success' })
	setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 600)
  },
})
