import { call, callWithToast, requestId, toastError } from '../../../utils/api'
import { can, ensureRegistered } from '../../../utils/session'
import { addDays, today } from '../../../utils/date'
import { MEMBERSHIP_TYPE, TX_TYPE } from '../../../utils/format'

type ModalKind = '' | 'adjust' | 'renew' | 'toggle' | 'create' | 'status' | 'history' | 'teacher'

/** 自然月有效期最后一天（含），与后端 time.periodEnd 一致，仅用于表单预览 */
function periodEnd(start: string, n: number): string {
  const [y, m, d] = start.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const ty = t.getUTCFullYear()
  const tm = t.getUTCMonth()
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  const pad = (x: number) => (x < 10 ? '0' + x : '' + x)
  if (d > last) return `${ty}-${pad(tm + 1)}-${pad(last)}`
  return addDays(`${ty}-${pad(tm + 1)}-${pad(d)}`, -1)
}

const DEFAULT_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3 }

Page({
  data: {
    id: '',
    loading: true,
    st: {} as any,
    account: null as any,
    full: false,
    memberships: [] as any[],
    history: [] as any[],
    historyPage: 0,
    historyMore: false,
    canManage: false,
    canMembership: false,
    canCredit: false,
    canSuspend: false,
    canLedger: false,
    today: today(),
    presets: [10, 20, 30, 50] as number[],
    modal: { show: false, kind: '' as ModalKind, title: '', content: '', needReason: false, danger: false, target: null as any },
    adj: { sign: 1, n: '' },
    renew: { expireDate: '', credits: '', type: '', policyMode: '' },
    nc: { type: 'CLASS_PASS', credits: '', months: '', policyMode: 'unlimited', quota: '', startDate: today(), expireDate: '', customExpire: false, price: '', reqId: '' },
    hist: [] as any[],
  },

  onLoad(q: Record<string, string>) {
    this.setData({ id: q.id })
  },

  async onShow() {
    const s = await ensureRegistered()
    if (!s) return
    this.setData({
      canManage: can('student.manage'),
      canMembership: can('membership.manage'),
      canCredit: can('credit.manage'),
      canSuspend: can('student.suspend'),
      canLedger: can('transaction.view'),
    })
    this.load()
    call<any>('settings.get')
      .then((st) => st.membership && st.membership.passPresets && this.setData({ presets: st.membership.passPresets }))
      .catch(() => null)
  },

  async load() {
    try {
      const r = await call<any>('student.get', { studentId: this.data.id })
      this.setData({ st: r.student, account: r.account || null, full: r.memberships !== null, memberships: r.memberships || [], loading: false })
      this.loadHistory(0)
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  async loadHistory(page: number) {
    try {
      const r = await call<any>('attendance.studentHistory', { studentId: this.data.id, page })
      this.setData({ history: page ? this.data.history.concat(r.items) : r.items, historyMore: r.hasMore, historyPage: page })
    } catch (e) {
      /* 无权限时忽略 */
    }
  },

  moreHistory() {
    this.loadHistory(this.data.historyPage + 1)
  },

  copyField(e: WechatMiniprogram.TouchEvent) {
    const field = e.currentTarget.dataset.field as string
    if (field !== 'wxid' && field !== 'phone') return
    const st = this.data.st as any
    const value = st && typeof st[field] === 'string' ? st[field].trim() : ''
    if (!value) return
    wx.setClipboardData({
      data: value,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (/privacy|auth/i.test(msg)) {
          wx.showModal({ title: '无法复制', content: '请先同意隐私协议中的剪贴板使用授权后重试。', showCancel: false })
        } else {
          wx.showToast({ title: '复制失败', icon: 'none' })
        }
        console.error('[copyField]', field, msg)
      },
    })
  },

  edit() {
    wx.navigateTo({ url: `/pages/admin/student-form/index?id=${this.data.id}` })
  },

  toLedger() {
    wx.navigateTo({ url: `/pages/admin/ledger/index?studentId=${this.data.id}&name=${encodeURIComponent(this.data.st.name)}` })
  },

  openModal(kind: ModalKind, title: string, content: string, needReason: boolean, danger: boolean, target?: any) {
    this.setData({ modal: { show: true, kind, title, content, needReason, danger, target: target || null } })
  },

  closeModal() {
    this.setData({ 'modal.show': false })
  },

  openCreate() {
    this.setData({ nc: { type: 'CLASS_PASS', credits: '', months: '', policyMode: 'unlimited', quota: '', startDate: today(), expireDate: addDays(today(), 180), customExpire: false, price: '', reqId: requestId() } })
    this.openModal('create', '开通会员卡', '', false, false)
  },

  /** 根据类型/生效日/月数重新计算默认到期日（管理员未手动指定时） */
  recalcExpire() {
    const nc = this.data.nc
    if (nc.customExpire) return
    const exp = nc.type === 'CLASS_PASS'
      ? addDays(nc.startDate, 180)
      : periodEnd(nc.startDate, parseInt(nc.months, 10) || DEFAULT_MONTHS[nc.type])
    this.setData({ 'nc.expireDate': exp })
  },

  askTeacher() {
    const a = this.data.account
    if (!a) return
    if (a.teaching) this.openModal('teacher', '撤销老师', '撤销后该账号仍保留学员身份，历史课程与签到记录不受影响。', true, true)
    else this.openModal('teacher', '设为老师', '设为老师后可在工作台管理所授课程，并保留学员身份。', false, false)
  },

  askStatus() {
    const off = this.data.st.status !== 'suspended'
    this.openModal('status', off ? '停用学员' : '恢复学员', off ? '停用后学员将无法签到。' : '', true, off)
  },

  onCardAction(e: WechatMiniprogram.CustomEvent) {
    const { op, item } = e.detail as { op: string; item: any }
    if (op === 'adjust') {
      if (!this.data.canCredit) { wx.showToast({ title: '无权限', icon: 'none' }); return }
      this.setData({ adj: { sign: 1, n: '' } })
      this.openModal('adjust', item.policyMode === 'quota' ? '调整次数额度' : '调整课时', `${item.name} 当前剩余 ${item.remainingCredits} 次`, true, false, item)
    } else if (op === 'renew') {
      const base = item.expireDate >= today() ? item.expireDate : addDays(today(), -1)
      const exp = item.type === 'CLASS_PASS' ? addDays(base, 180) : periodEnd(addDays(base, 1), DEFAULT_MONTHS[item.type] || 1)
      this.setData({ renew: { expireDate: exp, credits: '', type: item.type, policyMode: item.policyMode } })
      this.openModal('renew', '续费 / 延长有效期', `${MEMBERSHIP_TYPE[item.type] || ''} ${item.name} 当前到期：${item.expireDate}`, false, false, item)
    } else if (op === 'history') {
      this.loadMembershipHistory(item)
    } else if (op === 'toggle') {
      const off = item.status !== 'suspended'
      this.openModal('toggle', off ? '冻结会员卡' : '解冻会员卡', off ? '冻结期间不能使用该卡签到。' : '', true, off, item)
    }
  },

  async loadMembershipHistory(item: any) {
    try {
      const r = await call<any>('membership.history', { membershipId: item._id })
      const hist = r.items.map((t: any) => ({ ...t, typeText: TX_TYPE[t.type] || t.type }))
      this.setData({ hist })
      this.openModal('history', '会员卡历史', `${MEMBERSHIP_TYPE[item.type] || ''} ${item.name}`, false, false, item)
    } catch (e) {
      toastError(e)
    }
  },

  setSign(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'adj.sign': Number(e.currentTarget.dataset.s) })
  },
  onAdjN(e: WechatMiniprogram.Input) {
    this.setData({ 'adj.n': e.detail.value })
  },
  onRenewDate(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'renew.expireDate': e.detail.value as string })
  },
  onRenewCredits(e: WechatMiniprogram.Input) {
    this.setData({ 'renew.credits': e.detail.value })
  },
  setNcType(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'nc.type': e.currentTarget.dataset.t, 'nc.months': '' })
    this.recalcExpire()
  },
  setNcPolicy(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'nc.policyMode': e.currentTarget.dataset.m })
  },
  setPreset(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'nc.credits': String(e.currentTarget.dataset.n) })
  },
  onNc(e: WechatMiniprogram.Input) {
    this.setData({ [`nc.${e.currentTarget.dataset.k}`]: e.detail.value })
    if (e.currentTarget.dataset.k === 'months') this.recalcExpire()
  },
  onNcStart(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'nc.startDate': e.detail.value as string })
    this.recalcExpire()
  },
  onNcExpire(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'nc.expireDate': e.detail.value as string, 'nc.customExpire': true })
  },
  resetNcExpire() {
    this.setData({ 'nc.customExpire': false })
    this.recalcExpire()
  },

  async onModalConfirm(e: WechatMiniprogram.CustomEvent) {
    const reason = e.detail.reason as string
    const { kind, target } = this.data.modal
    let r: any = null
    if (kind === 'adjust') {
      const n = parseInt(this.data.adj.n, 10)
      if (!(n > 0)) { wx.showToast({ title: '请输入课时数', icon: 'none' }); return }
      this.closeModal()
      r = await callWithToast('membership.adjustCredits', { membershipId: target._id, delta: n * this.data.adj.sign, reason }, '处理中')
    } else if (kind === 'renew') {
      const rn = this.data.renew
      const credits = parseInt(rn.credits || '0', 10) || 0
      const payload: Record<string, any> = { membershipId: target._id, expireDate: rn.expireDate, credits }
      this.closeModal()
      r = await callWithToast('membership.renew', payload, '处理中')
    } else if (kind === 'history') {
      this.closeModal()
      return
    } else if (kind === 'toggle') {
      this.closeModal()
      r = await callWithToast('membership.setStatus', { membershipId: target._id, status: target.status === 'suspended' ? 'active' : 'suspended', reason }, '处理中')
    } else if (kind === 'teacher') {
      this.closeModal()
      const enable = !(this.data.account && this.data.account.teaching)
      r = await callWithToast('student.setTeacher', { studentId: this.data.id, enable, reason: reason || undefined }, '处理中')
    } else if (kind === 'status') {
      this.closeModal()
      r = await callWithToast('student.setStatus', { studentId: this.data.id, status: this.data.st.status === 'suspended' ? 'active' : 'suspended', reason }, '处理中')
    } else if (kind === 'create') {
      const nc = this.data.nc
      const payload: Record<string, any> = { studentId: this.data.id, type: nc.type, startDate: nc.startDate, expireDate: nc.expireDate, requestId: nc.reqId }
      if (nc.expireDate < nc.startDate) { wx.showToast({ title: '到期日期不能早于生效日期', icon: 'none' }); return }
      if (nc.type === 'CLASS_PASS') {
        const c = parseInt(nc.credits, 10)
        if (!(c > 0)) { wx.showToast({ title: '请输入课时数', icon: 'none' }); return }
        payload.credits = c
      } else {
        payload.months = parseInt(nc.months, 10) || DEFAULT_MONTHS[nc.type]
        payload.policyMode = nc.policyMode
        if (nc.policyMode === 'quota') {
          const q = parseInt(nc.quota, 10)
          if (!(q > 0)) { wx.showToast({ title: '请输入有效期内次数', icon: 'none' }); return }
          payload.quota = q
        }
      }
      if (nc.price) payload.priceCents = Math.round(parseFloat(nc.price) * 100) || 0
      this.closeModal()
      r = await callWithToast<any>('membership.create', payload, '开卡中')
      if (r && r.merged && !r.idempotent) {
        wx.showToast({ title: `已并入原次卡：${r.previousBalance} → ${r.newBalance} 节`, icon: 'none', duration: 2500 })
        this.load()
        return
      }
    }
    if (r) {
      wx.showToast({ title: '已完成', icon: 'success' })
      this.load()
    }
  },
})
