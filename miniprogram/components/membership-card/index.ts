Component({
  properties: {
    item: { type: Object, value: {} },
    manage: { type: Boolean, value: false },
  },
  methods: {
    emit(op: string) {
      this.triggerEvent('action', { op, item: this.data.item })
    },
    adjust() {
      this.emit('adjust')
    },
    renew() {
      this.emit('renew')
    },
    toggle() {
      this.emit('toggle')
    },
    history() {
      this.emit('history')
    },
  },
})
