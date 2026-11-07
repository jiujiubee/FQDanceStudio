import { getSession, hasStaffRole, isStudentPreview } from '../utils/session'

interface TabItem { path: string; text: string; icon: string }

const HOME: TabItem = { path: '/pages/home/index', text: '首页', icon: 'dashboard' }
const SCHEDULE: TabItem = { path: '/pages/schedule/index', text: '课程', icon: 'calendar' }
const HISTORY: TabItem = { path: '/pages/history/index', text: '上课记录', icon: 'history' }
const WORKBENCH: TabItem = { path: '/pages/workbench/index', text: '工作台', icon: 'list' }
const MINE: TabItem = { path: '/pages/mine/index', text: '我的', icon: 'user' }

/**
 * 根据角色生成底部导航：
 * 学员：首页/课程/签到记录/我的；
 * 店主与老师共用同一结构：首页/工作台/我的，具体功能由权限控制（前后端均校验）。
 */
export function tabsFor(): TabItem[] {
  const s = getSession()
  if (!s || !s.registered) return [HOME, SCHEDULE, MINE]
  if (hasStaffRole(s) && !isStudentPreview()) return [HOME, WORKBENCH, MINE]
  return [HOME, SCHEDULE, HISTORY, MINE]
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
