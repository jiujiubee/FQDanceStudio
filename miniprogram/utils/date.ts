/**
 * 日期工具：统一使用 Asia/Shanghai（UTC+8）。与云函数 lib/time.js 规则一致。
 * 本文件不依赖任何其他模块，可在 Node 测试中直接加载。
 */
export const OFFSET_MS = 8 * 3600 * 1000
export const DAY_MS = 24 * 3600 * 1000
export const WEEKDAY_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
export const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日']

const pad = (n: number): string => (n < 10 ? '0' + n : String(n))

export function toDate(ms: number): string {
  const d = new Date(ms + OFFSET_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function toTime(ms: number): string {
  const d = new Date(ms + OFFSET_MS)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export function today(nowMs?: number): string {
  return toDate(nowMs === undefined ? Date.now() : nowMs)
}

export function toMs(date: string, time?: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = (time || '00:00').split(':').map(Number)
  return Date.UTC(y, m - 1, d, h, mi) - OFFSET_MS
}

export function addDays(date: string, n: number): string {
  return toDate(toMs(date) + n * DAY_MS)
}

/** 1=周一 … 7=周日 */
export function weekday(date: string): number {
  const w = new Date(toMs(date, '12:00')).getUTCDay()
  return w === 0 ? 7 : w
}

export function weekStart(date: string): string {
  return addDays(date, 1 - weekday(date))
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export interface WeekDay {
  date: string
  day: number
  weekday: string
  isToday: boolean
  isSelected: boolean
  isPast: boolean
  count: number
}

/** 生成一周（周一至周日）的展示数据 */
export function buildWeek(start: string, todayStr: string, selected: string, marks?: Record<string, number>): WeekDay[] {
  const out: WeekDay[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i)
    out.push({
      date: d,
      day: Number(d.slice(8)),
      weekday: WEEKDAY_SHORT[i],
      isToday: d === todayStr,
      isSelected: d === selected,
      isPast: d < todayStr,
      count: (marks && marks[d]) || 0,
    })
  }
  return out
}

/** 周导航：不允许回到本周之前 */
export function shiftWeek(current: string, delta: number, todayStr: string): string | null {
  const next = addDays(current, delta * 7)
  if (next < weekStart(todayStr)) return null
  return next
}

/** 切换周后默认选中的日期：本周选今天，其他周选周一 */
export function defaultSelected(start: string, todayStr: string): string {
  return start === weekStart(todayStr) ? todayStr : start
}

/** ISO 周序号（用于「第N周」标题） */
export function isoWeek(date: string): number {
  const thursday = addDays(date, 4 - weekday(date))
  const yearStart = `${thursday.slice(0, 4)}-01-01`
  return Math.floor((toMs(thursday) - toMs(yearStart)) / DAY_MS / 7) + 1
}

/** 周历标题：如「2024年6月」，跨月显示「2024年6月 - 7月」 */
export function weekTitle(start: string): string {
  const end = addDays(start, 6)
  const y = start.slice(0, 4)
  const m1 = Number(start.slice(5, 7))
  const m2 = Number(end.slice(5, 7))
  if (m1 === m2) return `${y}年${m1}月`
  if (end.slice(0, 4) !== y) return `${y}年${m1}月 - ${end.slice(0, 4)}年${m2}月`
  return `${y}年${m1}月 - ${m2}月`
}

export interface MonthCell {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  disabled: boolean
  count: number
}

/** 月历网格：周一开头，6 行 x 7 列 */
export function buildMonth(month: string, todayStr: string, selected: string[], marks?: Record<string, number>, minDate?: string): MonthCell[] {
  const first = `${month}-01`
  const start = addDays(first, 1 - weekday(first))
  const sel = new Set(selected)
  const cells: MonthCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i)
    cells.push({
      date: d,
      day: Number(d.slice(8)),
      inMonth: d.slice(0, 7) === month,
      isToday: d === todayStr,
      isSelected: sel.has(d),
      disabled: !!minDate && d < minDate,
      count: (marks && marks[d]) || 0,
    })
  }
  return cells
}

export function monthTitle(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`
}

/** 2024-06-03 → 6月3日 周一 */
export function dateCN(date: string, withYear?: boolean): string {
  if (!date) return ''
  const s = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 ${WEEKDAY_CN[weekday(date) - 1]}`
  return withYear ? `${date.slice(0, 4)}年${s}` : s
}

/** 毫秒时间戳 → 2024年6月3日 10:30 */
export function dateTimeCN(ms: number | null | undefined): string {
  if (!ms) return ''
  const d = toDate(ms)
  return `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日 ${toTime(ms)}`
}

export function durationCN(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}小时${m}分钟` : `${h}小时`
}
