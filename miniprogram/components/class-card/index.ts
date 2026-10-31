/** 课程卡片。mode=student 显示签到按钮；mode=staff 显示签到统计；mode=plain 仅展示 */
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
    checkin() {
      this.triggerEvent('checkin', { id: (this.data.item as any)._id })
    },
  },
})
