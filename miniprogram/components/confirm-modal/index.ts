/** 确认弹窗，可选必填原因（needReason）。事件：confirm {reason}、cancel */
Component({
  options: { multipleSlots: true },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '确认操作' },
    content: { type: String, value: '' },
    confirmText: { type: String, value: '确定' },
    cancelText: { type: String, value: '取消' },
    danger: { type: Boolean, value: false },
    needReason: { type: Boolean, value: false },
    reasonPlaceholder: { type: String, value: '请填写原因（必填）' },
    disabled: { type: Boolean, value: false },
  },
  data: { reason: '' },
  observers: {
    show(v: boolean) {
      if (v) this.setData({ reason: '' })
    },
  },
  methods: {
    noop() {},
    onReason(e: WechatMiniprogram.Input) {
      this.setData({ reason: e.detail.value })
    },
    cancel() {
      this.triggerEvent('cancel')
    },
    confirm() {
      if (this.data.disabled) return
      const reason = this.data.reason.trim()
      if (this.data.needReason && !reason) {
        wx.showToast({ title: '请填写原因', icon: 'none' })
        return
      }
      this.triggerEvent('confirm', { reason })
    },
  },
})
