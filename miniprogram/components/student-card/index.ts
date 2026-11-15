import { LOCAL_AVATAR } from '../../utils/image'

Component({
  properties: {
    item: { type: Object, value: {}, observer() { this.setData({ failed: false }) } },
    selectable: { type: Boolean, value: false },
    checked: { type: Boolean, value: false },
  },
  data: {
    defaultAvatar: LOCAL_AVATAR,
    failed: false,
  },
  methods: {
    onAvatarError() {
      this.setData({ failed: true })
    },
    tap() {
      this.triggerEvent('open', { id: (this.data.item as any)._id })
    },
  },
})
