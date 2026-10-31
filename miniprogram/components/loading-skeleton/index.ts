Component({
  properties: {
    count: { type: Number, value: 3 },
  },
  data: { rows: [0, 1, 2] as number[] },
  observers: {
    count(n: number) {
      this.setData({ rows: Array.from({ length: n }, (_, i) => i) })
    },
  },
})
