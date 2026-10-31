Component({
  properties: {
    list: { type: Array, value: [] },
    canMark: { type: Boolean, value: false },
    emptyText: { type: String, value: '暂无记录' },
  },
  methods: {
    mark(e: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('mark', e.currentTarget.dataset)
    },
  },
})
