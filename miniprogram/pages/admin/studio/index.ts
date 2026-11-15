import { call, callWithToast, toastError } from '../../../utils/api'
import { can, ensureRegistered } from '../../../utils/session'
import { uploadWithThumb, uploadPoster, AVATAR_THUMB_WIDTH } from '../../../utils/image'

function splitList(s: string): string[] {
  return s.split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean)
}

async function upload(userId: string, tmp: string): Promise<string> {
  if (!userId) throw new Error('登录状态无效，请重新进入')
  const ext = (tmp.match(/\.(jpg|jpeg|png|webp)$/i) || ['.jpg'])[0].toLowerCase()
  const r = await wx.cloud.uploadFile({ cloudPath: `avatars/${userId}/${Date.now()}_${Math.floor(Math.random() * 1e6)}${ext}`, filePath: tmp })
  if (!r || !r.fileID || r.fileID.indexOf('cloud://') !== 0) throw new Error('云存储未返回文件标识')
  return r.fileID
}

function isCancel(e: any): boolean {
  return !!(e && typeof e.errMsg === 'string' && /cancel/i.test(e.errMsg))
}

function showUploadError(e: any) {
  const msg = (e && (e.message || e.errMsg)) || '未知错误'
  wx.showModal({ title: '上传失败', content: String(msg), showCancel: false })
}

async function pick(count: number, original = false): Promise<string[]> {
  const r = await wx.chooseMedia({ count, mediaType: ['image'], sizeType: [original ? 'original' : 'compressed'] })
  return r.tempFiles.map((f) => f.tempFilePath)
}

Page({
  data: {
    loading: true,
    userId: '',
    canStudio: false,
    canTeacher: false,
    s: { studioName: '', posters: [] as string[], thumbs: {} as Record<string, string>, intro: '', features: '', about: '', address: '', phone: '', logo: '', businessHours: '', latitude: null as number | null, longitude: null as number | null },
    teachers: [] as any[],
    editing: null as any,
    logoPreview: '',
    urls: {} as Record<string, string>,
    busy: false,
  },

  /** 记录 fileID 对应的可显示地址（HTTPS 临时地址或本地临时文件），页面不直接渲染 cloud:// */
  addUrls(map: Record<string, string>) {
    const urls = { ...this.data.urls }
    let changed = false
    Object.keys(map).forEach((k) => { if (k && map[k]) { urls[k] = map[k]; changed = true } })
    if (changed) this.setData({ urls })
  },

  async onLoad() {
    const s = await ensureRegistered()
    if (!s) return
    this.setData({ userId: s.userId || '', canStudio: can('settings.manage'), canTeacher: can('teacher.manage') })
    this.load()
  },

  async load() {
    try {
      const h = await call<any>('home.get', {})
      const teachers = this.data.canTeacher ? await call<any[]>('teacher.manageList', {}) : []
      this.setData({
        loading: false,
        logoPreview: h.logoUrl || '',
        teachers,
        s: {
          studioName: h.studioName || '', posters: h.posters || [], thumbs: h.thumbs || {}, intro: h.intro || '', features: (h.features || []).join('、'),
          about: h.about || '', address: h.address || '', phone: h.phone || '',
          logo: h.logo || '', businessHours: h.businessHours || '', latitude: h.latitude, longitude: h.longitude,
        },
      })
      const map: Record<string, string> = { ...(h.posterUrls || {}) }
      for (const t of teachers) {
        if (t.avatar && t.avatarUrl) map[t.avatar] = t.avatarUrl
        const ps = t.photos || []
        const us = t.photoUrls || []
        if (ps.length === us.length) ps.forEach((p: string, i: number) => { map[p] = us[i] })
      }
      this.addUrls(map)
    } catch (e) {
      this.setData({ loading: false })
      toastError(e)
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ [`s.${e.currentTarget.dataset.k}`]: e.detail.value })
  },

  async addPoster() {
    if (!this.data.canStudio) return
    const left = 6 - this.data.s.posters.length
    if (left <= 0) return
    let files: string[]
    try {
      files = await pick(left, true)
    } catch (e) {
      if (!isCancel(e)) showUploadError(e)
      return
    }
    wx.showLoading({ title: '上传中', mask: true })
    const ids: string[] = []
    const local: Record<string, string> = {}
    try {
      for (const f of files) {
        const id = await uploadPoster(this.data.userId, f)
        ids.push(id)
        local[id] = f
      }
    } catch (e) {
      wx.hideLoading()
      showUploadError(e)
      return
    }
    wx.hideLoading()
    this.addUrls(local)
    const prev = this.data.s.posters
    this.setData({ 's.posters': prev.concat(ids) })
    if (!(await this.persistPosters())) this.setData({ 's.posters': prev })
  },

  async removePoster(e: WechatMiniprogram.TouchEvent) {
    const prev = this.data.s.posters
    const list = prev.slice()
    list.splice(Number(e.currentTarget.dataset.i), 1)
    this.setData({ 's.posters': list })
    if (!(await this.persistPosters())) this.setData({ 's.posters': prev })
  },

  /** 海报变更后立即写入数据库，学生端首页即可读取 */
  async persistPosters(): Promise<boolean> {
    const s = this.data.s
    if (!s.studioName.trim()) {
      wx.showToast({ title: '请先填写工作室名称', icon: 'none' })
      return false
    }
    const r = await callWithToast('studio.update', this.studioPayload(), '保存中')
    if (r) wx.showToast({ title: '海报已保存', icon: 'success' })
    return !!r
  },

  studioPayload() {
    const s = this.data.s
    return {
      studioName: s.studioName.trim(), posters: s.posters, thumbs: s.thumbs, intro: s.intro, features: splitList(s.features),
      about: s.about,
      logo: s.logo, businessHours: s.businessHours, latitude: s.latitude, longitude: s.longitude,
    }
  },

  /** 海报左移/右移调整顺序 */
  async movePoster(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i)
    const j = i + Number(e.currentTarget.dataset.d)
    const prev = this.data.s.posters
    if (j < 0 || j >= prev.length) return
    const list = prev.slice()
    ;[list[i], list[j]] = [list[j], list[i]]
    this.setData({ 's.posters': list })
    if (!(await this.persistPosters())) this.setData({ 's.posters': prev })
  },

  /** 更换某张海报 */
  async replacePoster(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i)
    let f: string
    try {
      [f] = await pick(1, true)
    } catch (err) {
      if (!isCancel(err)) showUploadError(err)
      return
    }
    wx.showLoading({ title: '上传中', mask: true })
    let id: string
    try {
      id = await uploadPoster(this.data.userId, f)
      this.addUrls({ [id]: f })
    } catch (err) {
      wx.hideLoading()
      showUploadError(err)
      return
    }
    wx.hideLoading()
    const prev = this.data.s.posters
    const list = prev.slice()
    list[i] = id
    this.setData({ 's.posters': list })
    if (!(await this.persistPosters())) this.setData({ 's.posters': prev })
  },

  previewPoster(e: WechatMiniprogram.TouchEvent) {
    const urls = this.data.s.posters.map((p) => this.data.urls[p] || p)
    wx.previewImage({ urls, current: urls[Number(e.currentTarget.dataset.i)] })
  },

  async changeLogo() {
    let f: string
    try {
      [f] = await pick(1)
    } catch (err) {
      if (!isCancel(err)) showUploadError(err)
      return
    }
    wx.showLoading({ title: '上传中', mask: true })
    try {
      const r = await uploadWithThumb(this.data.userId, f, AVATAR_THUMB_WIDTH)
      this.setData({ logoPreview: f, 's.logo': r.fileID, 's.thumbs': r.thumb ? { ...this.data.s.thumbs, [r.fileID]: r.thumb } : this.data.s.thumbs })
      wx.hideLoading()
    } catch (err) {
      wx.hideLoading()
      showUploadError(err)
    }
  },

  /** 在地图上选取地址，记录经纬度供学生端导航 */
  chooseLocation() {
    wx.chooseLocation({
      success: (r) => {
        this.setData({ 's.address': r.address || r.name || this.data.s.address, 's.latitude': r.latitude, 's.longitude': r.longitude })
      },
      fail: (err) => { if (!isCancel(err)) showUploadError(err) },
    })
  },

  previewHome() {
    wx.switchTab({ url: '/pages/home/index' })
  },

  async saveStudio() {
    const s = this.data.s
    if (!s.studioName.trim()) { wx.showToast({ title: '请输入工作室名称', icon: 'none' }); return }
    this.setData({ busy: true })
    const r = await callWithToast('studio.update', this.studioPayload(), '保存中')
    this.setData({ busy: false })
    if (r) wx.showToast({ title: '已保存', icon: 'success' })
  },

  editTeacher(e: WechatMiniprogram.TouchEvent) {
    const t = this.data.teachers.find((x) => x._id === e.currentTarget.dataset.id)
    if (!t) return
    this.setData({ editing: { ...t, styles: (t.styles || []).join('、'), photos: (t.photos || []).slice(), sort: String(t.sort) } })
  },

  cancelEdit() {
    this.setData({ editing: null })
  },

  onTInput(e: WechatMiniprogram.Input) {
    this.setData({ [`editing.${e.currentTarget.dataset.k}`]: e.detail.value })
  },

  async changeAvatar() {
    try {
      const [f] = await pick(1)
      wx.showLoading({ title: '上传中' })
      const r = await uploadWithThumb(this.data.userId, f, AVATAR_THUMB_WIDTH)
      this.addUrls({ [r.fileID]: f })
      this.setData({ 'editing.avatar': r.fileID, 'editing.avatarThumb': r.thumb })
    } catch (e) {
      /* 取消 */
    }
    wx.hideLoading()
  },

  async addPhoto() {
    const left = 9 - this.data.editing.photos.length
    if (left <= 0) return
    try {
      const files = await pick(left)
      wx.showLoading({ title: '上传中' })
      const ids = []
      for (const f of files) {
        const id = await upload(this.data.userId, f)
        this.addUrls({ [id]: f })
        ids.push(id)
      }
      this.setData({ 'editing.photos': this.data.editing.photos.concat(ids) })
    } catch (e) {
      /* 取消 */
    }
    wx.hideLoading()
  },

  removePhoto(e: WechatMiniprogram.TouchEvent) {
    const list = this.data.editing.photos.slice()
    list.splice(Number(e.currentTarget.dataset.i), 1)
    this.setData({ 'editing.photos': list })
  },

  async saveTeacher() {
    const t = this.data.editing
    if (!t.name.trim()) { wx.showToast({ title: '请输入姓名', icon: 'none' }); return }
    this.setData({ busy: true })
    const r = await callWithToast('teacher.updateProfile', {
      teacherId: t._id, name: t.name.trim(), avatar: t.avatar, avatarThumb: t.avatarThumb || '', intro: t.intro,
      styles: splitList(t.styles), photos: t.photos, sort: parseInt(t.sort, 10) || 0,
    }, '保存中')
    this.setData({ busy: false })
    if (r) {
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ editing: null })
      this.load()
    }
  },
})
