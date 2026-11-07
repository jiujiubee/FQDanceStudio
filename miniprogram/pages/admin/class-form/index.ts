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
      startTime: '12:00',
      endTime: '13:30',
      duration: '90',
      capacity: '',
      description: '',
      room: '',
      level: 0,
      date: today(),
      startDate: today(),
      endDate: addDays(today(), 56),
      reason: '',
    },
    preview: '',
    busy: false,
    reqId: '',
  },

  async onLoad(q: Record<string, string>) {
    // 每次进入页面生成独立请求编号（data 字面量只在模块加载时求值一次，不能在其中生成）
    const t0 = today()
    this.setData({ reqId: requestId(), today: t0, 'form.date': t0, 'form.startDate': t0, 'form.endDate': addDays(t0, 56) })
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
        form: { ...this.data.form, name: c.name, startTime: c.startTime, duration: String(c.duration), capacity: c.capacity ? String(c.capacity) : '', description: c.description, room: c.room || '', level: c.level || 0, date: c.date },
      })
    }
    this.syncEnd()
    this.updatePreview()
  },

  setMode(e: WechatMiniprogram.TouchEvent) {
    this.setData({ mode: e.currentTarget.dataset.key })
    this.updatePreview()
  },

  onInput(e: WechatMiniprogram.Input) {
    const k = e.currentTarget.dataset.k
    this.setData({ [`form.${k}`]: e.detail.value })
    if (k === 'duration') this.syncEnd()
  },

  /** 根据开始时间与时长计算结束时间 */
  syncEnd() {
    const f = this.data.form
    const d = parseInt(f.duration, 10)
    const [h, m] = f.startTime.split(':').map(Number)
    const end = h * 60 + m + (d > 0 ? d : 0)
    this.setData({ 'form.endTime': end >= 1440 ? '' : `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` })
  },

  /** 修改结束时间：反算时长 */
  onEndTime(e: WechatMiniprogram.PickerChange) {
    const v = e.detail.value as string
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
    const d = toMin(v) - toMin(this.data.form.startTime)
    if (d < 15) { wx.showToast({ title: '结束时间需晚于开始时间15分钟以上', icon: 'none' }); return }
    this.setData({ 'form.endTime': v, 'form.duration': String(d) })
  },

  onLevel(e: WechatMiniprogram.TouchEvent) {
    const n = Number(e.currentTarget.dataset.n)
    this.setData({ 'form.level': this.data.form.level === n ? 0 : n })
  },

  onTeacher(e: WechatMiniprogram.PickerChange) {
    this.setData({ teacherIndex: Number(e.detail.value) })
  },

  onTime(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'form.startTime': e.detail.value as string })
    this.syncEnd()
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
    if (this.data.busy) return
    const f = this.data.form
    const t = this.data.teachers[this.data.teacherIndex]
    if (!f.name.trim()) { wx.showToast({ title: '请输入课程名称', icon: 'none' }); return }
    if (!t) { wx.showToast({ title: '请选择授课老师', icon: 'none' }); return }
    const duration = parseInt(f.duration, 10)
    if (!(duration >= 15 && duration <= 480)) { wx.showToast({ title: '时长需在15-480分钟', icon: 'none' }); return }
    if (!f.endTime) { wx.showToast({ title: '课程不能跨天', icon: 'none' }); return }
    if (f.capacity && !(parseInt(f.capacity, 10) >= 1)) { wx.showToast({ title: '人数上限需大于0', icon: 'none' }); return }
    if (!this.data.editId && this.data.mode === 'single' && !f.date) { wx.showToast({ title: '请选择上课日期', icon: 'none' }); return }
    const base: Record<string, any> = {
      name: f.name.trim(),
      teacherId: t._id,
      startTime: f.startTime,
      duration,
      capacity: f.capacity ? parseInt(f.capacity, 10) : null,
      description: f.description.trim(),
      room: f.room.trim(),
      level: f.level,
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
      if (ok && !(ok.created > 0)) {
        wx.showModal({ title: '排课失败', content: '课程未能保存，请重试', showCancel: false })
        ok = null
      }
      if (ok) {
        const skipped = ok.skipped && ok.skipped.length ? `\n已跳过重复日期：${ok.skipped.join('、')}` : ''
        await new Promise((res) => wx.showModal({ title: '排课成功', content: `已创建 ${ok.created} 节课程${skipped}`, showCancel: false, complete: res }))
      }
    }
    // 无论成功失败都生成新请求号，下一次创建不会复用旧请求结果
    this.setData({ busy: false, reqId: requestId() })
    if (!ok) return
    wx.navigateBack()
  },
})
