/** 搜索框：输入防抖 400ms 后触发 search 事件 */
Component({
  properties: {
    placeholder: { type: String, value: '搜索' },
  },
  data: { value: '' },
  methods: {
    input(e: WechatMiniprogram.Input) {
      this.setData({ value: e.detail.value })
      const self = this as any
      if (self._t) clearTimeout(self._t)
      self._t = setTimeout(() => this.triggerEvent('search', { keyword: this.data.value.trim() }), 400)
    },
    confirm() {
      const self = this as any
      if (self._t) clearTimeout(self._t)
      this.triggerEvent('search', { keyword: this.data.value.trim() })
    },
    clear() {
      this.setData({ value: '' })
      this.triggerEvent('search', { keyword: '' })
    },
  },
})
