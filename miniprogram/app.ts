import { CLOUD_ENV_ID } from './config'

App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({ title: '提示', content: '请升级微信到最新版本后使用', showCancel: false })
      return
    }
    wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: false })

    const updater = wx.getUpdateManager()
    updater.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已准备好，是否重启应用？',
        success: (res) => {
          if (res.confirm) updater.applyUpdate()
        },
      })
    })
  },
})
