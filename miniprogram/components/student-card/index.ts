Component({
  properties: {
    item: { type: Object, value: {} },
    selectable: { type: Boolean, value: false },
    checked: { type: Boolean, value: false },
  },
  methods: {
    tap() {
      this.triggerEvent('open', { id: (this.data.item as any)._id })
    },
  },
})
