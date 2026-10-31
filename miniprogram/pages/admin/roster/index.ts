import { call, callWithToast, toastError } from '../../../utils/api'
import { ensureRegistered } from '../../../utils/session'

Page({
  data: {
    id: '',
    cls: {} as any,
    hasSeries: false,
    target: 'class',
    groups: [] as string[],
    selGroups: {} as Record<string, boolean>,
    selected: {} as Record<string, any>,
    selectedList: [] as any[],
    results: [] as any[],
    busy: false,
  },

  async onLoad(q: Record<string, string>) {
    const s = await ensureRegistered()
    if (!s) return
    this.setData({ id: q.id })
    try {
      const [r, groups] = await Promise.all([call<any>('class.get', { classId: q.id }), call<string[]>('student.groups').catch(() => [])])
      const selGroups: Record<string, boolean> = {}
      r.rosterConfig.groups.forEach((g: string) => (selGroups[g] = true))
      this.setData({
        cls: r.class,
        hasSeries: !!(r.series && r.series.count > 1),
        target: r.rosterSource === 'series' ? 'series' : 'class',
        groups,
        selGroups,
      })
      const ids: string[] = r.rosterConfig.studentIds
      if (ids.length) {
        // 逐个加载名单学员详情
        const list = await Promise.all(ids.map((id) => call<any>('student.get', { studentId: id }).then((x) => x.student).catch(() => null)))
        const selected: Record<string, any> = {}
        list.filter(Boolean).forEach((st: any) => (selected[st._id] = st))
        this.setData({ selected })
        this.syncList()
      }
    } catch (e) {
      toastError(e)
    }
  },

  syncList() {
    this.setData({ selectedList: Object.keys(this.data.selected).map((k) => this.data.selected[k]) })
  },

  setTarget(e: WechatMiniprogram.TouchEvent) {
    this.setData({ target: e.currentTarget.dataset.t })
  },

  toggleGroup(e: WechatMiniprogram.TouchEvent) {
    const g = e.currentTarget.dataset.g as string
    this.setData({ [`selGroups.${g}`]: !this.data.selGroups[g] })
  },

  async onSearch(e: WechatMiniprogram.CustomEvent) {
    const keyword = e.detail.keyword as string
    try {
      const r = await call<any>('student.search', { keyword, status: 'active' })
      this.setData({ results: r.items })
    } catch (err) {
      toastError(err)
    }
  },

  toggle(e: WechatMiniprogram.CustomEvent) {
    const id = e.detail.id as string
    const selected = { ...this.data.selected }
    if (selected[id]) delete selected[id]
    else {
      const s = this.data.results.find((r) => r._id === id)
      if (s) selected[id] = s
    }
    this.setData({ selected })
    this.syncList()
  },

  clearAll() {
    this.setData({ selected: {}, selGroups: {} })
    this.syncList()
  },

  async save() {
    const groups = Object.keys(this.data.selGroups).filter((g) => this.data.selGroups[g])
    this.setData({ busy: true })
    const r = await callWithToast(
      'roster.set',
      { classId: this.data.id, target: this.data.target, studentIds: Object.keys(this.data.selected), groups },
      '保存中',
    )
    this.setData({ busy: false })
    if (!r) return
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 600)
  },
})
