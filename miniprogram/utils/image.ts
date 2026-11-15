/**
 * 图片工具：上传时生成缩略图；首页按 fileID + 版本缓存到本地文件系统，重复进入不再下载。
 * 仅头像/Logo 缓存压缩图；海报缓存原始高清图（按 fileID 区分版本，更换后自动刷新）；课程视频不经过这里。
 */

const CACHE_KEY = 'imgCache:v2'
const MAX_ENTRIES = 60

export const POSTER_THUMB_WIDTH = 1080
export const AVATAR_THUMB_WIDTH = 240
export const DEFAULT_IMAGE = '/assets/icons/empty-muted.svg'
/** 本地静态资源：随小程序包发布，首屏直接显示 */
export const LOCAL_LOGO = '/assets/images/logo.jpg'
export const LOCAL_AVATAR = '/assets/images/avatar-default.png'
export const LOCAL_POSTER = '/assets/images/poster-default.jpg'

interface CacheEntry { p: string; v: string }
type CacheMap = Record<string, CacheEntry>

let memory: CacheMap | null = null
const inflight: Partial<Record<string, Promise<string>>> = {}

function readCache(): CacheMap {
  if (!memory) {
    try {
      memory = (wx.getStorageSync(CACHE_KEY) as CacheMap) || {}
    } catch (e) {
      memory = {}
    }
  }
  return memory
}

function removeFile(path: string) {
  try { wx.getFileSystemManager().removeSavedFile({ filePath: path }) } catch (e) { /* ignore */ }
}

function writeCache(map: CacheMap) {
  const keys = Object.keys(map)
  if (keys.length > MAX_ENTRIES) {
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) {
      removeFile(map[k].p)
      delete map[k]
    }
  }
  memory = map
  try { wx.setStorageSync(CACHE_KEY, map) } catch (e) { /* ignore */ }
}

function exists(path: string): boolean {
  try {
    wx.getFileSystemManager().accessSync(path)
    return true
  } catch (e) {
    return false
  }
}

/** 同步读取已缓存的本地路径；无缓存或版本不一致（云端已更新）返回空串 */
export function cachedPath(fileID: string, version?: string): string {
  if (!fileID) return ''
  const e = readCache()[fileID]
  if (e && (version === undefined || e.v === version) && exists(e.p)) return e.p
  return ''
}

/**
 * 获取可显示的本地路径：命中缓存直接返回；否则从云存储下载一次并持久保存，替换旧版本文件。
 * 非 cloud:// 地址原样返回。失败时返回空串，由调用方继续显示本地默认图。
 */
export function localImage(fileID: string, version = ''): Promise<string> {
  if (!fileID || fileID.indexOf('cloud://') !== 0) return Promise.resolve(fileID || '')
  const hit = cachedPath(fileID, version)
  if (hit) return Promise.resolve(hit)
  const key = `${fileID}|${version}`
  const pending = inflight[key]
  if (pending) return pending
  const task = new Promise<string>((resolve) => {
    wx.cloud.downloadFile({
      fileID,
      success: (r) => {
        wx.getFileSystemManager().saveFile({
          tempFilePath: r.tempFilePath,
          success: (s) => {
            const map = { ...readCache() }
            const old = map[fileID]
            if (old && old.p !== s.savedFilePath) removeFile(old.p)
            delete map[fileID]
            map[fileID] = { p: s.savedFilePath, v: version }
            writeCache(map)
            resolve(s.savedFilePath)
          },
          fail: () => resolve(r.tempFilePath),
        })
      },
      fail: () => resolve(''),
    })
  }).finally(() => { delete inflight[key] })
  inflight[key] = task
  return task
}

/** 删除不再使用的缓存图片（如被替换或下线的海报/头像） */
export function pruneCache(keep: string[]) {
  const set: Record<string, true> = {}
  keep.forEach((k) => { if (k) set[k] = true })
  const map = { ...readCache() }
  let changed = false
  for (const k of Object.keys(map)) {
    if (!set[k]) { removeFile(map[k].p); delete map[k]; changed = true }
  }
  if (changed) writeCache(map)
}

/** 压缩为指定宽度的缩略图；不支持或失败时返回空串 */
function compress(tmp: string, width: number): Promise<string> {
  return new Promise((resolve) => {
    wx.compressImage({
      src: tmp,
      quality: 70,
      compressedWidth: width,
      success: (r: any) => resolve(r.tempFilePath),
      fail: () => resolve(''),
    } as any)
  })
}

async function uploadOne(userId: string, tmp: string, suffix: string): Promise<string> {
  const ext = (tmp.match(/\.(jpg|jpeg|png|webp)$/i) || ['.jpg'])[0].toLowerCase()
  const r = await wx.cloud.uploadFile({ cloudPath: `avatars/${userId}/${Date.now()}_${Math.floor(Math.random() * 1e6)}${suffix}${ext}`, filePath: tmp })
  if (!r || !r.fileID || r.fileID.indexOf('cloud://') !== 0) throw new Error('云存储未返回文件标识')
  return r.fileID
}

/** 海报：只上传原始高清图（不压缩、不生成缩略图），独立文件名，与头像/缩略图互不覆盖 */
export async function uploadPoster(userId: string, tmp: string): Promise<string> {
  if (!userId) throw new Error('登录状态无效，请重新进入')
  return uploadOne(userId, tmp, '_poster')
}

/** 上传原图，并额外上传一张压缩缩略图（仅用于头像/Logo 等小尺寸图片） */
export async function uploadWithThumb(userId: string, tmp: string, thumbWidth: number): Promise<{ fileID: string; thumb: string }> {
  if (!userId) throw new Error('登录状态无效，请重新进入')
  const fileID = await uploadOne(userId, tmp, '')
  let thumb = ''
  try {
    const small = await compress(tmp, thumbWidth)
    if (small) thumb = await uploadOne(userId, small, '_t')
  } catch (e) {
    thumb = ''
  }
  return { fileID, thumb }
}
