/** 页面通用：同步自定义底部导航选中项 */
export function syncTab(page: any, path: string): void {
  if (typeof page.getTabBar === 'function') {
    const bar = page.getTabBar()
    if (bar && bar.refresh) bar.refresh(path)
  }
}
