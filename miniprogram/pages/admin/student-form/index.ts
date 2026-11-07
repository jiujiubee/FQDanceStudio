import { call, callWithToast } from '../../../utils/api'
import { ensureRegistered } from '../../../utils/session'
import { isValidPhone, normalizePhone } from '../../../utils/format'

const GENDERS = [
  { value: '', text: '未设置' },
  { value: 'male', text: '男' },
  { value: 'female', text: '女' },
]

const LIST_PAGE = 'pages/admin/students/index'

/** 保存后返回「学员管理」列表（列表页 onShow 会自动刷新） */
function backToList() {
  const pages = getCurrentPages()
  const idx = pages.map((p) => p.route).lastIndexOf(LIST_PAGE)
  if (idx >= 0) wx.navigateBack({ delta: pages.length - 1 - idx })
  else wx.redirectTo({ url: '/' + LIST_PAGE })
}

Page({
  data: {
    id: '',
    genders: GENDERS,
    genderIndex: 0,
    form: { name: '', wxid: '', phone: '', gender: '', birthday: '', emergencyContact: '', remark: '', groupsText: '' },
    busy: false,
  },

  async onLoad(q: Record<string, string>) {
    const s = await ensureRegistered()
    if (!s || !q.id) return
    wx.setNavigationBarTitle({ title: '编辑学员' })
    const r = await call<any>('student.get', { studentId: q.id }).catch(() => null)
    if (!r) return
    const st = r.student
    this.setData({
      id: q.id,
      genderIndex: Math.max(0, GENDERS.findIndex((g) => g.value === st.gender)),
      form: {
        name: st.name, wxid: st.wxid, phone: st.phone, gender: st.gender, birthday: st.birthday,
        emergencyContact: st.emergencyContact, remark: st.remark, groupsText: (st.groups || []).join(' '),
      },
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

  async save() {
    const f = this.data.form
    if (!f.name.trim()) { wx.showToast({ title: '请输入姓名', icon: 'none' }); return }
    const phone = normalizePhone(f.phone || '')
    if (phone && !isValidPhone(phone)) { wx.showToast({ title: '请输入正确的中国大陆手机号', icon: 'none' }); return }
    const payload = {
      name: f.name.trim(), wxid: f.wxid.trim(), phone, gender: f.gender, birthday: f.birthday,
      emergencyContact: f.emergencyContact.trim(), remark: f.remark.trim(),
      groups: f.groupsText.split(/[\s,，]+/).filter(Boolean),
    }
    this.setData({ busy: true })
    const r = this.data.id
      ? await callWithToast('student.update', { ...payload, studentId: this.data.id }, '保存中')
      : await callWithToast<any>('student.create', payload, '保存中')
    this.setData({ busy: false })
    if (!r) return
    if (!this.data.id) {
      await new Promise((res) =>
        wx.showModal({ title: '登记成功', content: '学员使用该手机号在小程序中完成验证注册后，将自动关联此档案。', showCancel: false, complete: res }),
      )
      backToList()
      return
    }
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(backToList, 600)
  },
})
