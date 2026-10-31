import { addDays, buildWeek, shiftWeek, weekStart, weekTitle, today as todayStr, WeekDay } from '../../utils/date'

/**
 * 周历：周一至周日。
 * - 不允许翻到本周之前（allowPast=false 时）
 * - maxWeeks 限制向后可翻周数
 * 事件：weekchange {weekStart}、select {date}
 */
Component({
  properties: {
    weekStart: { type: String, value: '' },
    selected: { type: String, value: '' },
    marks: { type: Object, value: {} },
    today: { type: String, value: '' },
    allowPast: { type: Boolean, value: false },
    maxWeeks: { type: Number, value: 26 },
  },
  data: { days: [] as WeekDay[], title: '', canPrev: false, canNext: true, isCurrent: true },
  observers: {
    'weekStart, selected, marks, today': function () {
      ;(this as any).render()
    },
  },
  lifetimes: {
    attached() {
      ;(this as any).render()
    },
  },
  methods: {
    render() {
      const t = this.data.today || todayStr()
      const ws = this.data.weekStart || weekStart(t)
      const cur = weekStart(t)
      const limit = shiftWeek(cur, this.data.maxWeeks, t)
      this.setData({
        days: buildWeek(ws, t, this.data.selected, this.data.marks as Record<string, number>),
        title: weekTitle(ws),
        canPrev: this.data.allowPast || ws > cur,
        canNext: !limit || ws < limit,
        isCurrent: ws === cur,
      })
    },
    move(delta: number) {
      const t = this.data.today || todayStr()
      const ws = this.data.weekStart || weekStart(t)
      const next = this.data.allowPast ? addDays(ws, delta * 7) : shiftWeek(ws, delta, t)
      if (!next) return
      this.triggerEvent('weekchange', { weekStart: next })
    },
    prev() {
      if (this.data.canPrev) this.move(-1)
    },
    next() {
      if (this.data.canNext) this.move(1)
    },
    backToday() {
      this.triggerEvent('weekchange', { weekStart: weekStart(this.data.today || todayStr()) })
    },
    pick(e: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('select', { date: e.currentTarget.dataset.date })
    },
  },
})
