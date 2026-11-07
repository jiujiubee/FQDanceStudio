/** 课程卡片。mode=student 显示预约/取消预约（学员不可自主签到）；mode=staff 显示签到统计；mode=plain 仅展示 */
Component({
  properties: {
    item: { type: Object, value: {} },
    mode: { type: String, value: 'plain' },
    busy: { type: Boolean, value: false },
  },
  methods: {
    tap() {
      this.triggerEvent('open', { id: (this.data.item as any)._id })
    },
    book() {
      this.triggerEvent('book', { id: (this.data.item as any)._id })
    },
    cancelBook() {
      this.triggerEvent('cancelbook', { id: (this.data.item as any)._id })
    },
  },
})
