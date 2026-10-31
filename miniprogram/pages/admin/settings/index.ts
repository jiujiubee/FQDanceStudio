import { call, callWithToast, toastError } from '../../../utils/api'
import { can, ensureRegistered, login } from '../../../utils/session'

const PERM_TEXT: Record<string, string> = {
  'self.schedule.view': '查看课程表',
  'self.checkin': '自助签到',
  'self.attendance.view': '查看本人签到记录',
  'self.profile.edit': '编辑个人资料',
  'self.membership.view': '查看本人会员卡',
  'class.view.assigned': '查看自己的课程',
  'class.view.all': '查看全部课程',
  'class.manage': '排课与编辑课程',
  'class.cancel': '取消课程',
  'roster.manage': '管理上课名单',
  'attendance.view.assigned': '查看自己课程的签到',
  'attendance.view.all': '查看全部签到',
  'attendance.mark': '手动签到与更正',
  'student.view.basic': '查看学员基本信息',
  'student.view.all': '查看学员完整信息',
  'student.manage': '登记与编辑学员',
  'student.suspend': '停用/恢复学员',
  'membership.manage': '开卡、续费、冻结',
  'credit.manage': '增减课时',
  'transaction.view': '查看课时流水',
  'teacher.manage': '管理教师',
  'admin.manage': '管理管理员',
  'owner.manage': '管理店主',
  'audit.view': '查看操作日志',
  'settings.manage': '修改系统设置',
  'policy.manage': '修改会员规则',
  'permission.manage': '修改权限配置',
}

Page({
  data: {
    canSettings: false,
    canPolicy: false,
    canPerm: false,
    busy: false,
    s: {
      studioName: '', openBefore: '', closeAfter: '', privacyPolicyVersion: '',
      monthlyDefaultMode: 'unlimited', monthlyDefaultLimit: '', passDefaultValidDays: '', passPresetsText: '', refundOnCancel: true,
    },
    roleTabs: [
      { key: 'admin', text: '管理员' },
      { key: 'teacher', text: '教师' },
      { key: 'student', text: '学员' },
    ],
    role: 'teacher',
    perms: null as any,
    permRows: [] as { key: string; text: string; on: boolean; forbidden: boolean }[],
  },

  async onLoad() {
    const sess = await ensureRegistered()
    if (!sess) return
    this.setData({ canSettings: can('settings.manage'), canPolicy: can('policy.manage'), canPerm: can('permission.manage') })
    try {
      const st = await call<any>('settings.get')
      const m = st.membership || {}
      this.setData({
        s: {
          studioName: st.studioName,
          openBefore: String(st.checkin.openBeforeMinutes),
          closeAfter: String(st.checkin.closeAfterStartMinutes),
          privacyPolicyVersion: st.privacyPolicyVersion,
          monthlyDefaultMode: m.monthlyDefaultMode,
          monthlyDefaultLimit: String(m.monthlyDefaultLimit),
          passDefaultValidDays: String(m.passDefaultValidDays),
          passPresetsText: (m.passPresets || []).join(' '),
          refundOnCancel: !!m.refundOnCancel,
        },
      })
      if (this.data.canPerm) {
        const p = await call<any>('permissions.get')
        this.setData({ perms: p })
        this.buildRows()
      }
    } catch (e) {
      toastError(e)
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ [`s.${e.currentTarget.dataset.k}`]: e.detail.value })
  },

  setMode(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 's.monthlyDefaultMode': e.currentTarget.dataset.v })
  },

  onRefund(e: WechatMiniprogram.SwitchChange) {
    this.setData({ 's.refundOnCancel': e.detail.value })
  },

  async save() {
    const s = this.data.s
    const payload: Record<string, any> = {}
    if (this.data.canSettings) {
      Object.assign(payload, {
        studioName: s.studioName.trim(),
        privacyPolicyVersion: s.privacyPolicyVersion.trim(),
        checkin: { openBeforeMinutes: parseInt(s.openBefore, 10) || 0, closeAfterStartMinutes: parseInt(s.closeAfter, 10) || 0 },
      })
    }
    if (this.data.canPolicy) {
      payload.membership = {
        monthlyDefaultMode: s.monthlyDefaultMode,
        monthlyDefaultLimit: parseInt(s.monthlyDefaultLimit, 10) || 8,
        passDefaultValidDays: parseInt(s.passDefaultValidDays, 10) || 180,
        refundOnCancel: s.refundOnCancel,
        passPresets: s.passPresetsText.split(/[\s,，]+/).filter(Boolean).map((n) => parseInt(n, 10)).filter((n) => n > 0),
      }
    }
    this.setData({ busy: true })
    const r = await callWithToast('settings.update', payload, '保存中')
    this.setData({ busy: false })
    if (r) {
      login(true).catch(() => null)
      wx.showToast({ title: '已保存', icon: 'success' })
    }
  },

  buildRows() {
    const p = this.data.perms
    if (!p) return
    const cfg = p.roles[this.data.role]
    const rows = (p.all as string[]).map((key) => ({
      key,
      text: PERM_TEXT[key] || key,
      on: cfg.permissions.indexOf(key) >= 0,
      forbidden: cfg.forbidden.indexOf(key) >= 0,
    }))
    this.setData({ permRows: rows })
  },

  setRole(e: WechatMiniprogram.TouchEvent) {
    this.setData({ role: e.currentTarget.dataset.r })
    this.buildRows()
  },

  togglePerm(e: WechatMiniprogram.SwitchChange) {
    const i = (e.currentTarget.dataset as any).i as number
    this.setData({ [`permRows[${i}].on`]: e.detail.value })
  },

  async savePerm() {
    const permissions = this.data.permRows.filter((r) => r.on && !r.forbidden).map((r) => r.key)
    const r = await callWithToast('permissions.update', { role: this.data.role, permissions }, '保存中')
    if (r) {
      this.setData({ [`perms.roles.${this.data.role}.permissions`]: permissions })
      wx.showToast({ title: '已保存', icon: 'success' })
    }
  },

  async resetPerm() {
    const r = await callWithToast('permissions.update', { role: this.data.role, reset: true }, '处理中')
    if (!r) return
    const p = await call<any>('permissions.get').catch(() => null)
    if (p) {
      this.setData({ perms: p })
      this.buildRows()
    }
    wx.showToast({ title: '已恢复默认', icon: 'success' })
  },
})
