import { LOCAL_AVATAR } from '../../utils/image'

Component({
  properties: {
    list: { type: Array, value: [], observer() { this.setData({ failed: {} }) } },
    canMark: { type: Boolean, value: false },
    emptyText: { type: String, value: '暂无记录' },
  },
  data: {
    defaultAvatar: LOCAL_AVATAR,
    failed: {} as Record<string, boolean>,
  },
  methods: {
    onAvatarError(e: WechatMiniprogram.CustomEvent) {
      this.setData({ [`failed.${e.currentTarget.dataset.k}`]: true })
    },
    mark(e: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('mark', e.currentTarget.dataset)
    },
  },
})
