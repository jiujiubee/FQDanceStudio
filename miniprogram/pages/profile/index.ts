import { call, callWithToast } from '../../utils/api'
import { login } from '../../utils/session'
import { today } from '../../utils/date'

const GENDERS = [
  { value: '', text: '未设置' },
  { value: 'male', text: '男' },
  { value: 'female', text: '女' },
]

Page({
  data: {
    genders: GENDERS,
    genderIndex: 0,
    today: today(),
    isStudent: false,
    isTeacher: false,
    userId: '',
    form: { name: '', avatar: '', wxid: '', phone: '', gender: '', birthday: '', emergencyContact: '', bio: '' },
    newAvatarTmp: '',
    busy: false,
  },

  async onLoad() {
    const s = await login().catch(() => null)
    if (!s) return
    const p = await call<any>('profile.get').catch(() => null)
    if (!p) return
    const st = p.student || {}
    const t = p.teacher || {}
    this.setData({
      userId: s.userId || '',
      isStudent: !!p.student,
      isTeacher: !!p.teacher,
      form: {
        name: p.name || '',
        avatar: st.avatar || t.avatar || '',
        wxid: st.wxid || '',
        phone: st.phone || '',
        gender: st.gender || '',
        birthday: st.birthday || '',
        emergencyContact: st.emergencyContact || '',
        bio: t.bio || '',
      },
      genderIndex: Math.max(0, GENDERS.findIndex((g) => g.value === (st.gender || ''))),
    })
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ [`form.${e.currentTarget.dataset.k}`]: e.detail.value })
  },

  onGender(e: WechatMiniprogram.PickerChange) {
    const i = Number(e.detail.value)
    this.setData({ genderIndex: i, 'form.gender': GENDERS[i].value })
  },

  onBirthday(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'form.birthday': e.detail.value as string })
  },

  onAvatar(e: any) {
    const url = e.detail.avatarUrl as string
    if (url) this.setData({ 'form.avatar': url, newAvatarTmp: url })
  },

  async uploadAvatar(): Promise<string | null> {
    const tmp = this.data.newAvatarTmp
    if (!tmp) return null
    const ext = (tmp.match(/\.(jpg|jpeg|png|webp)$/i) || ['.jpg'])[0].toLowerCase()
    const r = await wx.cloud.uploadFile({ cloudPath: `avatars/${this.data.userId}/${Date.now()}${ext}`, filePath: tmp })
    return r.fileID
  },

  async save() {
    const f = this.data.form
    if (!f.name.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    if (f.phone && !/^1\d{10}$/.test(f.phone)) {
      wx.showToast({ title: '手机号格式不正确', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    const payload: Record<string, any> = { name: f.name.trim() }
    try {
      const fileID = await this.uploadAvatar()
      if (fileID) payload.avatar = fileID
    } catch (e) {
      wx.showToast({ title: '头像上传失败', icon: 'none' })
    }
    if (this.data.isStudent) Object.assign(payload, { wxid: f.wxid.trim(), phone: f.phone, gender: f.gender, birthday: f.birthday, emergencyContact: f.emergencyContact.trim() })
    if (this.data.isTeacher) payload.bio = f.bio.trim()
    const r = await callWithToast('profile.update', payload, '保存中')
    this.setData({ busy: false })
    if (!r) return
    await login(true).catch(() => null)
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 600)
  },
})
