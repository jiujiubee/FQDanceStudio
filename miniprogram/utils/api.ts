/**
 * 云函数调用封装。所有业务请求都发往统一云函数 `api`，
 * 身份（OpenID）由云开发在服务端注入，客户端不传递任何用户 ID / 角色 / 余额。
 */
export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

interface ApiResult<T> {
  ok: boolean
  data?: T
  code?: string
  message?: string
}

import { DEV_MODE } from '../config'

/** 开发模式下当前模拟身份（仅开发环境生效） */
export function getDevAs(): string {
  return DEV_MODE ? (wx.getStorageSync('devAs') as string) || '' : ''
}

export async function call<T = any>(action: string, data?: Record<string, any>): Promise<T> {
  let res: any
  const payload: Record<string, any> = { action, data: data || {} }
  const devAs = getDevAs()
  if (devAs) payload.devAs = devAs
  try {
    res = await wx.cloud.callFunction({ name: 'api', data: payload })
  } catch (e) {
    console.error('[api]', action, e)
    throw new ApiError('NETWORK', '网络异常，请检查网络后重试')
  }
  const r = res.result as ApiResult<T>
  if (!r || !r.ok) {
    throw new ApiError((r && r.code) || 'INTERNAL', (r && r.message) || '服务繁忙，请稍后再试')
  }
  return r.data as T
}

/** 调用并在失败时弹出提示；返回 null 表示失败 */
export async function callWithToast<T = any>(action: string, data?: Record<string, any>, loadingText?: string): Promise<T | null> {
  if (loadingText) wx.showLoading({ title: loadingText, mask: true })
  try {
    const r = await call<T>(action, data)
    if (loadingText) wx.hideLoading()
    return r
  } catch (e) {
    if (loadingText) wx.hideLoading()
    toastError(e)
    return null
  }
}

export function toastError(e: any): void {
  const msg = (e && e.message) || '操作失败'
  wx.showToast({ title: msg.length > 14 ? msg.slice(0, 14) + '…' : msg, icon: 'none', duration: 2500 })
  if (msg.length > 14) {
    setTimeout(() => wx.showModal({ title: '提示', content: msg, showCancel: false, confirmText: '知道了' }), 200)
  }
}

/** 幂等请求编号：防止重复提交生成重复课程/会员卡 */
export function requestId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `r${Date.now().toString(36)}${rand}`
}
