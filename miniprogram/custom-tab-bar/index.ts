import { getSession, hasStaffRole } from '../utils/session'

interface TabItem { path: string; text: string; icon: string }

const SCHEDULE: TabItem = { path: '/pages/schedule/index', text: '课程', icon: 'calendar' }
const HISTORY: TabItem = { path: '/pages/history/index', text: '签到记录', icon: 'history' }
const WORKBENCH: TabItem = { path: '/pages/workbench/index', text: '工作台', icon: 'dashboard' }
const MINE: TabItem = { path: '/pages/mine/index', text: '我的', icon: 'user' }

/** 根据角色生成底部导航：学员看课程/签到记录；员工看工作台；同时是学员的员工两者都有 */
export function tabsFor(): TabItem[] {
  const s = getSession()
  if (!s || !s.registered) return [SCHEDULE, MINE]
  const staff = hasStaffRole(s)
  const list: TabItem[] = []
  if (staff) list.push(WORKBENCH)
  if (!staff || s.student) list.push(SCHEDULE, HISTORY)
  list.push(MINE)
  return list
}

Component({
  data: { items: [] as TabItem[], selected: '' },
  methods: {
    refresh(path: string) {
      this.setData({ items: tabsFor(), selected: path })
    },
    go(e: WechatMiniprogram.TouchEvent) {
      const path = e.currentTarget.dataset.path as string
      if (path === this.data.selected) return
      wx.switchTab({ url: path })
    },
  },
})
