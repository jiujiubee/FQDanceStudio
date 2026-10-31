import { addMonths, buildMonth, monthTitle, today as todayStr, WEEKDAY_SHORT, MonthCell } from '../../utils/date'

/**
 * 月历：可单选或多选（multiple=true，用于多日期排课）。
 * 事件：monthchange {month}、select {date}（单选）、change {dates}（多选）
 */
Component({
  properties: {
    month: { type: String, value: '' },
    selected: { type: Array, value: [] },
    marks: { type: Object, value: {} },
    multiple: { type: Boolean, value: false },
    minDate: { type: String, value: '' },
  },
  data: { cells: [] as MonthCell[], title: '', weekdays: WEEKDAY_SHORT, cur: '' },
  observers: {
    'month, selected, marks, minDate': function () {
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
      const t = todayStr()
      const m = this.data.month || this.data.cur || t.slice(0, 7)
      this.setData({
        cur: m,
        title: monthTitle(m),
        cells: buildMonth(m, t, this.data.selected as string[], this.data.marks as Record<string, number>, this.data.minDate || undefined),
      })
    },
    shift(n: number) {
      const m = addMonths(this.data.cur, n)
      this.triggerEvent('monthchange', { month: m })
      if (!this.data.month) {
        this.setData({ cur: m })
        ;(this as any).render()
      }
    },
    prev() {
      this.shift(-1)
    },
    next() {
      this.shift(1)
    },
    pick(e: WechatMiniprogram.TouchEvent) {
      const { date, disabled } = e.currentTarget.dataset as { date: string; disabled: boolean }
      if (disabled) return
      if (!this.data.multiple) {
        this.triggerEvent('select', { date })
        return
      }
      const set = new Set(this.data.selected as string[])
      if (set.has(date)) set.delete(date)
      else set.add(date)
      this.triggerEvent('change', { dates: [...set].sort() })
    },
  },
})
