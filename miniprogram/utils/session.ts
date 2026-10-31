import { call } from './api'

export type Role = 'owner' | 'admin' | 'teacher' | 'student'

export interface Session {
  registered: boolean
  userId?: string
  role: Role | null
  roles: Role[]
  isStaff?: boolean
  roleLabel?: string
  status?: string
  name?: string
  permissions?: string[]
  student?: any
  teacher?: any
  privacyPolicyVersion: string
  privacyAgreed?: boolean
  studioName: string
}

let current: Session | null = null
let pending: Promise<Session> | null = null

/**
 * 登录：调用 wx.login() 获取临时 code 以确保微信登录态有效，
 * 再调用云函数，由云开发在服务端完成 code → OpenID 换取并注入身份。
 */
export function login(force?: boolean): Promise<Session> {
  if (current && !force) return Promise.resolve(current)
  if (pending) return pending
  pending = new Promise<Session>((resolve, reject) => {
    wx.login({
      success: async () => {
        try {
          current = await call<Session>('auth.login')
          resolve(current)
        } catch (e) {
          reject(e)
        } finally {
          pending = null
        }
      },
      fail: () => {
        pending = null
        reject(new Error('微信登录失败，请重试'))
      },
    })
  })
  return pending
}

export function getSession(): Session | null {
  return current
}

export function can(perm: string): boolean {
  return !!(current && current.permissions && current.permissions.indexOf(perm) >= 0)
}

export function isStaff(): boolean {
  return !!current && hasStaffRole(current)
}

export function hasRole(role: Role): boolean {
  return !!current && (current.roles || []).indexOf(role) >= 0
}

export function hasStaffRole(s: Session): boolean {
  return (s.roles || []).some((r) => r === 'owner' || r === 'admin' || r === 'teacher')
}

/** 未注册时跳转注册页；返回是否已注册 */
export async function ensureRegistered(): Promise<Session | null> {
  try {
    const s = await login()
    if (!s.registered) {
      wx.redirectTo({ url: '/pages/register/index' })
      return null
    }
    return s
  } catch (e: any) {
    if (e && e.code === 'ACCOUNT_SUSPENDED') {
      wx.showModal({ title: '账户已停用', content: e.message, showCancel: false })
    } else {
      wx.showToast({ title: (e && e.message) || '登录失败', icon: 'none' })
    }
    return null
  }
}

export function clearSession(): void {
  current = null
}
