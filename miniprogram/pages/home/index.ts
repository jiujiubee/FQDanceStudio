import { call, toastError } from '../../utils/api'
import { ensureRegistered } from '../../utils/session'
import { syncTab } from '../../utils/tab'
import { cachedPath, localImage, pruneCache, LOCAL_LOGO, LOCAL_AVATAR, LOCAL_POSTER } from '../../utils/image'

const HOME_CACHE_KEY = 'homeData:v3'
const DEFAULT_RATIO = 16 / 9

interface PosterView {
  key: string
  file: string
  src: string
  loaded: boolean
  failed: boolean
}

/** Logo 等小图使用压缩缩略图；海报不经过这里，始终使用原始高清图 */
function thumbOf(home: any, fileID: string): string {
  return (home.thumbs && home.thumbs[fileID]) || ''
}

/** 教师头像：优先压缩缩略图，没有缩略图（如微信头像直接上传）时使用原头像 fileID */
function avatarId(t: any): string {
  return t.avatarThumb || t.avatar || ''
}

let signature = ''

Page({
  data: {
    loading: true,
    home: null as any,
    posters: [] as PosterView[],
    posterHeight: 0,
    logoSrc: LOCAL_LOGO,
    defaultPoster: LOCAL_POSTER,
    defaultAvatar: LOCAL_AVATAR,
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
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load(): Promise<void> {
    try {
      const home = await call<any>('home.get', {})
      try { wx.setStorageSync(HOME_CACHE_KEY, home) } catch (e) { /* ignore */ }
      this.applyHome(home)
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  /** 图片相关数据未变化时不重建图片列表，避免重复加载；先显示本地默认图，再异步替换 */
  applyHome(home: any) {
    if (home.studioName) wx.setNavigationBarTitle({ title: home.studioName })
    const tList = home.teachers || []
    const teacherIds = tList.map(avatarId)
    const teacherVers = tList.map((t: any) => String(t.updatedAt || ''))
    const sig = JSON.stringify([home.posters, home.thumbs, home.logo, teacherIds, teacherVers])
    if (sig === signature && this.data.home) {
      const teachers = tList.map((t: any, i: number) => { const old = this.data.home.teachers[i]; return { ...t, avatarSrc: old && old._id === t._id && old.avatarSrc !== LOCAL_AVATAR ? old.avatarSrc : (cachedPath(teacherIds[i], teacherVers[i]) || t.avatarUrl || LOCAL_AVATAR) } })
      this.setData({ home: { ...home, teachers }, loading: false })
      return
    }
    signature = sig
    // 海报使用独立的高清原图；更换海报会产生新的 fileID，缓存自然更新
    const posterUrls = home.posterUrls || {}
    const posters: PosterView[] = (home.posters || []).map((p: string) => (
      { key: p, file: p, src: cachedPath(p) || posterUrls[p] || LOCAL_POSTER, loaded: false, failed: !p }
    ))
    if (!posters.length) posters.push({ key: 'local', file: '', src: LOCAL_POSTER, loaded: false, failed: false })
    // 先用本地缓存，其次用云函数换取的 HTTPS 临时地址（可显示他人头像），都没有才用默认头像
    const teachers = tList.map((t: any, i: number) => ({ ...t, avatarSrc: cachedPath(teacherIds[i], teacherVers[i]) || t.avatarUrl || LOCAL_AVATAR }))
    const logoId = home.logo ? (thumbOf(home, home.logo) || home.logo) : ''
    this.setData({ home: { ...home, teachers }, posters, posterHeight: 0, logoSrc: cachedPath(logoId) || home.logoUrl || LOCAL_LOGO, loading: false })

    pruneCache([...posters.map((p) => p.file), logoId, ...teacherIds])
    // 海报：先加载当前（第一张），其余在切换时按需预加载下一张
    this.ensurePoster(0)
    if (logoId) localImage(logoId).then((src) => { if (src) this.setData({ logoSrc: src }) })
    teachers.forEach((t: any, i: number) => {
      if (teacherIds[i] && !cachedPath(teacherIds[i], teacherVers[i])) {
        localImage(teacherIds[i], teacherVers[i]).then((src) => { if (src) this.setData({ [`home.teachers[${i}].avatarSrc`]: src }) })
      }
    })
  },

  ensurePoster(i: number) {
    const p = this.data.posters[i]
    if (!p || !p.file || cachedPath(p.file)) return
    localImage(p.file).then((src) => {
      const cur = this.data.posters[i]
      if (!cur || cur.key !== p.key) return
      if (src) this.setData({ [`posters[${i}].src`]: src })
      else if (cur.src === LOCAL_POSTER) this.setData({ [`posters[${i}].failed`]: true })
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
      // 海报全屏宽度：高度严格按图片比例计算，左右贴边且完整显示、不裁切不留边
      const boxW = wx.getWindowInfo().windowWidth
      patch.posterHeight = Math.round(boxW / ratio)
    }
    this.setData(patch)
    if (i === 0) this.ensurePoster(1)
  },

  onPosterError(e: WechatMiniprogram.CustomEvent) {
    const i = Number(e.currentTarget.dataset.i)
    this.setData({ [`posters[${i}].src`]: LOCAL_POSTER, [`posters[${i}].failed`]: true, [`posters[${i}].loaded`]: true })
    if (i === 0) this.ensurePoster(1)
  },

  onAvatarError(e: WechatMiniprogram.CustomEvent) {
    const i = Number(e.currentTarget.dataset.i)
    const t = this.data.home && this.data.home.teachers[i]
    const next = t && t.avatarUrl && t.avatarSrc !== t.avatarUrl ? t.avatarUrl : LOCAL_AVATAR
    this.setData({ [`home.teachers[${i}].avatarSrc`]: next })
  },

  onLogoError() {
    this.setData({ logoSrc: LOCAL_LOGO })
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
