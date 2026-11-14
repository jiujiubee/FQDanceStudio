import { call, toastError } from '../../utils/api'
import { ensureRegistered } from '../../utils/session'
import { syncTab } from '../../utils/tab'
import { cachedPath, localImage, DEFAULT_IMAGE } from '../../utils/image'

const HOME_CACHE_KEY = 'homeData:v1'
const RELOAD_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_RATIO = 16 / 9

interface PosterView {
  key: string
  src: string
  loaded: boolean
  failed: boolean
}

/** 首页显示用的图片地址：优先缩略图 */
function displayId(home: any, fileID: string): string {
  return (home.thumbs && home.thumbs[fileID]) || fileID
}

let lastLoadAt = 0
let signature = ''

Page({
  data: {
    loading: true,
    home: null as any,
    posters: [] as PosterView[],
    posterHeight: 0,
    logoSrc: '',
    defaultImage: DEFAULT_IMAGE,
  },

  onLoad() {
    signature = ''
    try {
      const home = wx.getStorageSync(HOME_CACHE_KEY)
      if (home) this.applyHome(home)
    } catch (e) { /* ignore */ }
  },

  async onShow() {
    syncTab(this, '/pages/home/index')
    const s = await ensureRegistered()
    if (!s) return
    syncTab(this, '/pages/home/index')
    if (!lastLoadAt || Date.now() - lastLoadAt > RELOAD_INTERVAL_MS) this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load(): Promise<void> {
    try {
      const home = await call<any>('home.get', {})
      lastLoadAt = Date.now()
      try { wx.setStorageSync(HOME_CACHE_KEY, home) } catch (e) { /* ignore */ }
      this.applyHome(home)
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  /** 图片相关数据未变化时不重建图片列表，避免重复加载 */
  applyHome(home: any) {
    if (home.studioName) wx.setNavigationBarTitle({ title: home.studioName })
    const teacherIds = (home.teachers || []).map((t: any) => t.avatarThumb || t.avatar || '')
    const sig = JSON.stringify([home.posters, home.thumbs, home.logo, teacherIds])
    if (sig === signature && this.data.home) {
      const teachers = (home.teachers || []).map((t: any, i: number) => ({ ...t, avatarSrc: this.data.home.teachers[i] ? this.data.home.teachers[i].avatarSrc : '' }))
      this.setData({ home: { ...home, teachers }, loading: false })
      return
    }
    signature = sig
    const posters: PosterView[] = (home.posters || []).map((p: string) => {
      const src = cachedPath(displayId(home, p))
      return { key: p, src, loaded: false, failed: false }
    })
    const teachers = (home.teachers || []).map((t: any, i: number) => ({ ...t, avatarSrc: cachedPath(teacherIds[i]) }))
    const logoId = home.logo ? displayId(home, home.logo) : ''
    this.setData({ home: { ...home, teachers }, posters, posterHeight: 0, logoSrc: cachedPath(logoId), loading: false })

    // 海报：先加载第一张，其余在切换时按需预加载下一张
    this.ensurePoster(0)
    if (logoId) localImage(logoId).then((src) => this.setData({ logoSrc: src }))
    teachers.forEach((t: any, i: number) => {
      if (teacherIds[i] && !t.avatarSrc) localImage(teacherIds[i]).then((src) => this.setData({ [`home.teachers[${i}].avatarSrc`]: src }))
    })
  },

  ensurePoster(i: number) {
    const home = this.data.home
    const p = this.data.posters[i]
    if (!home || !p || p.src) return
    localImage(displayId(home, p.key)).then((src) => {
      const cur = this.data.posters[i]
      if (cur && cur.key === p.key && !cur.src) this.setData({ [`posters[${i}].src`]: src })
    })
  },

  onSwiper(e: WechatMiniprogram.SwiperChange) {
    const i = e.detail.current
    this.ensurePoster(i)
    this.ensurePoster((i + 1) % Math.max(1, this.data.posters.length))
  },

  /** 第一张海报加载后按其比例确定轮播高度；所有海报均以 aspectFit 完整显示 */
  onPosterLoad(e: WechatMiniprogram.CustomEvent) {
    const i = Number(e.currentTarget.dataset.i)
    const patch: Record<string, any> = { [`posters[${i}].loaded`]: true }
    if (i === 0 || !this.data.posterHeight) {
      const d = e.detail as any
      const ratio = d && d.width && d.height ? d.width / d.height : DEFAULT_RATIO
      const winW = wx.getWindowInfo().windowWidth
      const boxW = winW - (64 * winW) / 750
      patch.posterHeight = Math.round(Math.min(Math.max(boxW / ratio, boxW * 0.4), boxW * 1.5))
    }
    this.setData(patch)
    if (i === 0) this.ensurePoster(1)
  },

  onPosterError(e: WechatMiniprogram.CustomEvent) {
    const i = Number(e.currentTarget.dataset.i)
    this.setData({ [`posters[${i}].failed`]: true, [`posters[${i}].loaded`]: true })
    if (i === 0) this.ensurePoster(1)
  },

  onAvatarError(e: WechatMiniprogram.CustomEvent) {
    const i = Number(e.currentTarget.dataset.i)
    this.setData({ [`home.teachers[${i}].avatarSrc`]: '/assets/icons/user-muted.svg' })
  },

  onLogoError() {
    this.setData({ logoSrc: DEFAULT_IMAGE })
  },

  callPhone() {
    const h = this.data.home
    if (h && h.phone) wx.makePhoneCall({ phoneNumber: h.phone })
  },

  /** 打开地图位置与导航；未设置坐标时提示 */
  openMap() {
    const h = this.data.home
    if (!h || !h.address) return
    if (typeof h.latitude !== 'number' || typeof h.longitude !== 'number') {
      wx.setClipboardData({ data: h.address })
      wx.showToast({ title: '暂未设置地图位置，已复制地址', icon: 'none' })
      return
    }
    wx.openLocation({ latitude: h.latitude, longitude: h.longitude, name: h.studioName || '', address: h.address, scale: 16 })
  },

  openTeacher(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/teacher-detail/index?id=${e.currentTarget.dataset.id}` })
  },

  toSchedule() {
    wx.switchTab({ url: '/pages/schedule/index' })
  },
})
