import { call, callWithToast, requestId } from '../../../utils/api'
import { ensureRegistered } from '../../../utils/session'
import { addDays, today, weekday } from '../../../utils/date'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((text, i) => ({ text, value: i + 1, on: false }))

/** 纯函数：预估每周重复排课生成的节数 */
function countWeekly(start: string, end: string, wds: number[]): number {
  if (!start || !end || end < start || !wds.length) return 0
  let n = 0
  for (let d = start; d <= end; d = addDays(d, 1)) if (wds.indexOf(weekday(d)) >= 0) n++
  return n
}

Page({
  data: {
    modes: [
      { key: 'single', text: '单次' },
      { key: 'weekly', text: '每周重复' },
      { key: 'multi', text: '多个日期' },
    ],
    mode: 'single',
    editId: '',
    today: today(),
    teachers: [] as { _id: string; name: string }[],
    teacherIndex: -1,
    weekdays: WEEKDAYS,
    dates: [] as string[],
    form: {
      name: '',
      startTime: '19:00',
      duration: '90',
      capacity: '',
      description: '',
      date: today(),
      startDate: today(),
      endDate: addDays(today(), 56),
      reason: '',
    },
    preview: '',
    busy: false,
    reqId: requestId(),
  },

  async onLoad(q: Record<string, string>) {
    const s = await ensureRegistered()
    if (!s) return
    const teachers = await call<any[]>('class.teacherOptions').catch(() => [])
    this.setData({ teachers })
    if (q.date && q.date >= this.data.today) this.setData({ 'form.date': q.date, 'form.startDate': q.date })
    if (q.id) {
      wx.setNavigationBarTitle({ title: '编辑课程' })
      const r = await call<any>('class.get', { classId: q.id }).catch(() => null)
      if (!r) return
      const c = r.class
      this.setData({
        editId: q.id,
        teacherIndex: teachers.findIndex((t) => t._id === c.teacherId),
        form: { ...this.data.form, name: c.name, startTime: c.startTime, duration: String(c.duration), capacity: c.capacity ? String(c.capacity) : '', description: c.description, date: c.date },
      })
    }
    this.updatePreview()
  },

  setMode(e: WechatMiniprogram.TouchEvent) {
    this.setData({ mode: e.currentTarget.dataset.key })
    this.updatePreview()
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ [`form.${e.currentTarget.dataset.k}`]: e.detail.value })
  },

  onTeacher(e: WechatMiniprogram.PickerChange) {
    this.setData({ teacherIndex: Number(e.detail.value) })
  },

  onTime(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'form.startTime': e.detail.value as string })
  },

  onDate(e: WechatMiniprogram.PickerChange) {
    this.setData({ [`form.${e.currentTarget.dataset.k}`]: e.detail.value })
    this.updatePreview()
  },

  toggleWeekday(e: WechatMiniprogram.TouchEvent) {
    const i = e.currentTarget.dataset.i as number
    this.setData({ [`weekdays[${i}].on`]: !this.data.weekdays[i].on })
    this.updatePreview()
  },

  onDates(e: WechatMiniprogram.CustomEvent) {
    this.setData({ dates: e.detail.dates })
    this.updatePreview()
  },

  updatePreview() {
    let preview = ''
    if (this.data.mode === 'weekly') {
      const wds = this.data.weekdays.filter((w) => w.on).map((w) => w.value)
      const n = countWeekly(this.data.form.startDate, this.data.form.endDate, wds)
      preview = n ? `将生成 ${n} 节课程（与同一老师同一时段已有课程重复的日期将自动跳过）` : ''
    } else if (this.data.mode === 'multi' && this.data.dates.length) {
      preview = `将生成 ${this.data.dates.length} 节课程`
    }
    this.setData({ preview })
  },

  async submit() {
    const f = this.data.form
    const t = this.data.teachers[this.data.teacherIndex]
    if (!f.name.trim()) { wx.showToast({ title: '请输入课程名称', icon: 'none' }); return }
    if (!t) { wx.showToast({ title: '请选择授课老师', icon: 'none' }); return }
    const duration = parseInt(f.duration, 10)
    if (!(duration >= 15 && duration <= 480)) { wx.showToast({ title: '时长需在15-480分钟', icon: 'none' }); return }
    const base: Record<string, any> = {
      name: f.name.trim(),
      teacherId: t._id,
      startTime: f.startTime,
      duration,
      capacity: f.capacity ? parseInt(f.capacity, 10) : null,
      description: f.description.trim(),
    }
    this.setData({ busy: true })
    let ok: any
    if (this.data.editId) {
      ok = await callWithToast('class.update', { ...base, classId: this.data.editId, date: f.date, reason: f.reason.trim() }, '保存中')
    } else {
      const payload: Record<string, any> = { ...base, mode: this.data.mode, requestId: this.data.reqId }
      if (this.data.mode === 'single') payload.date = f.date
      if (this.data.mode === 'weekly') {
        payload.weekdays = this.data.weekdays.filter((w) => w.on).map((w) => w.value)
        if (!payload.weekdays.length) {
          this.setData({ busy: false })
          { wx.showToast({ title: '请选择上课星期', icon: 'none' }); return }
        }
        Object.assign(payload, { startDate: f.startDate, endDate: f.endDate })
      }
      if (this.data.mode === 'multi') {
        if (!this.data.dates.length) {
          this.setData({ busy: false })
          { wx.showToast({ title: '请选择上课日期', icon: 'none' }); return }
        }
        payload.dates = this.data.dates
      }
      ok = await callWithToast<any>('class.create', payload, '创建中')
      if (ok) {
        const skipped = ok.skipped && ok.skipped.length ? `\n已跳过重复日期：${ok.skipped.join('、')}` : ''
        await new Promise((res) => wx.showModal({ title: '排课成功', content: `已创建 ${ok.created} 节课程${skipped}`, showCancel: false, complete: res }))
      }
    }
    this.setData({ busy: false })
    if (!ok) {
      // 失败后生成新请求号，避免与失败请求冲突
      this.setData({ reqId: requestId() })
      return
    }
    wx.navigateBack()
  },
})
