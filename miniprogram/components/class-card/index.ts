/** 课程卡片。mode=student 显示预约/取消预约（学员不可自主签到）；mode=staff 显示签到统计；mode=plain 仅展示 */
import { LOCAL_AVATAR } from '../../utils/image'

Component({
  properties: {
    item: { type: Object, value: {}, observer() { this.setData({ failed: {} }) } },
    mode: { type: String, value: 'plain' },
    busy: { type: Boolean, value: false },
  },
  data: {
    defaultAvatar: LOCAL_AVATAR,
    failed: {} as Record<string, boolean>,
  },
  methods: {
    /** 头像临时地址失效或加载失败时回退到本地默认头像 */
    onAvatarError(e: WechatMiniprogram.CustomEvent) {
      this.setData({ [`failed.${e.currentTarget.dataset.k}`]: true })
    },
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
