/**
 * 图片工具：上传时生成缩略图；首页按 fileID 缓存到本地文件，重复进入不再下载。
 */

const CACHE_KEY = 'imgCache:v1'
const MAX_ENTRIES = 60

export const POSTER_THUMB_WIDTH = 1080
export const AVATAR_THUMB_WIDTH = 240
export const DEFAULT_IMAGE = '/assets/icons/empty-muted.svg'

type CacheMap = Record<string, string>

let memory: CacheMap | null = null
const inflight: Record<string, Promise<string>> = {}

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

function writeCache(map: CacheMap) {
  const keys = Object.keys(map)
  if (keys.length > MAX_ENTRIES) {
    const fs = wx.getFileSystemManager()
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) {
      try { fs.removeSavedFile({ filePath: map[k] }) } catch (e) { /* ignore */ }
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

/** 同步读取已缓存的本地路径（无缓存返回空串） */
export function cachedPath(fileID: string): string {
  if (!fileID) return ''
  const p = readCache()[fileID]
  if (p && exists(p)) return p
  return ''
}

/**
 * 获取可显示的本地路径：命中缓存直接返回；否则从云存储下载一次并持久保存。
 * 非 cloud:// 地址原样返回。失败时返回原 fileID，交由 <image> 自行加载。
 */
export function localImage(fileID: string): Promise<string> {
  if (!fileID || fileID.indexOf('cloud://') !== 0) return Promise.resolve(fileID || '')
  const hit = cachedPath(fileID)
  if (hit) return Promise.resolve(hit)
  if (inflight[fileID]) return inflight[fileID]
  const task = new Promise<string>((resolve) => {
    wx.cloud.downloadFile({
      fileID,
      success: (r) => {
        wx.getFileSystemManager().saveFile({
          tempFilePath: r.tempFilePath,
          success: (s) => {
            const map = { ...readCache() }
            delete map[fileID]
            map[fileID] = s.savedFilePath
            writeCache(map)
            resolve(s.savedFilePath)
          },
          fail: () => resolve(r.tempFilePath),
        })
      },
      fail: () => resolve(fileID),
    })
  }).finally(() => { delete inflight[fileID] })
  inflight[fileID] = task
  return task
}

/** 压缩为指定宽度的缩略图；不支持或失败时返回空串 */
function compress(tmp: string, width: number): Promise<string> {
  return new Promise((resolve) => {
    wx.compressImage({
      src: tmp,
      quality: 70,
      compressedWidth: width,
      success: (r) => resolve(r.tempFilePath),
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

/** 上传原图，并额外上传一张压缩缩略图（缩略图失败不影响原图） */
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
