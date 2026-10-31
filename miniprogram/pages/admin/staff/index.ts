import { call, callWithToast, toastError } from '../../../utils/api'
import { ensureRegistered, login } from '../../../utils/session'

const ROLE_TEXT: Record<string, string> = { teacher: '教师', admin: '管理员', owner: '店主' }

Page({
  data: {
    keyword: '',
    results: [] as any[],
    searched: false,
    staff: [] as any[],
    modal: { show: false, title: '', content: '', userId: '', role: '', grant: true },
  },

  async onShow() {
    const s = await ensureRegistered()
    if (!s) return
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    try {
      this.setData({ staff: await call<any[]>('staff.list') })
    } catch (e) {
      toastError(e)
    }
  },

  onKeyword(e: WechatMiniprogram.Input) {
    this.setData({ keyword: e.detail.value })
  },

  async search() {
    const keyword = this.data.keyword.trim()
    if (!keyword) return
    const r = await callWithToast<any[]>('staff.searchUsers', { keyword }, '搜索中')
    if (r) this.setData({ results: r, searched: true })
  },

  manage(e: WechatMiniprogram.TouchEvent) {
    const list = e.currentTarget.dataset.src === 'results' ? this.data.results : this.data.staff
    const u = list[e.currentTarget.dataset.i]
    const options: { text: string; run: () => void }[] = []
    ;(u.grantable || []).forEach((r: string) => options.push({ text: `授予${ROLE_TEXT[r]}`, run: () => this.ask(u, r, true) }))
    ;(u.revocable || []).forEach((r: string) => options.push({ text: `撤销${ROLE_TEXT[r]}`, run: () => this.ask(u, r, false) }))
    if (!options.length) {
      wx.showToast({ title: '无可执行的操作', icon: 'none' })
      return
    }
    wx.showActionSheet({ itemList: options.map((o) => o.text), success: (res) => options[res.tapIndex].run() })
  },

  ask(u: any, role: string, grant: boolean) {
    this.setData({
      modal: {
        show: true, userId: u.userId, role, grant,
        title: `${grant ? '授予' : '撤销'}${ROLE_TEXT[role]}`,
        content: `用户：${u.name}（当前：${u.roleLabel}）${!grant && role === 'teacher' ? '\n历史课程与签到记录将保留。' : ''}`,
      },
    })
  },

  closeModal() {
    this.setData({ 'modal.show': false })
  },

  async confirm(e: WechatMiniprogram.CustomEvent) {
    const { userId, role, grant } = this.data.modal
    this.setData({ 'modal.show': false })
    const r = await callWithToast(grant ? 'staff.grantRole' : 'staff.revokeRole', { userId, role, reason: e.detail.reason }, '处理中')
    if (!r) return
    wx.showToast({ title: '已更新', icon: 'success' })
    await login(true).catch(() => null)
    this.load()
    if (this.data.searched) this.search()
  },
})
