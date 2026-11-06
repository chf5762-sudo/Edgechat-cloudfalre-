import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { drizzle } from 'drizzle-orm/d1'
import { users } from '../../db/schema'

export const PASSCODE = '576257'
export const COOKIE_NAME = 'fd_auth'
export const SESSION_MAX_AGE = 180 * 24 * 60 * 60 // 180 days = 15,552,000 seconds

export const DEFAULT_USER = {
  id: 'local-user',
  name: 'FlareDraw Owner',
  email: 'owner@flaredraw.local',
}

async function signData(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function createSessionCookieValue(secret: string): Promise<string> {
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000
  const data = `${DEFAULT_USER.id}.${expiresAt}`
  const sig = await signData(data, secret)
  return `${data}.${sig}`
}

export async function verifySessionCookieValue(
  token: string | undefined,
  secret: string
): Promise<{ valid: boolean; userId?: string }> {
  if (!token) return { valid: false }
  const parts = token.split('.')
  if (parts.length !== 3) return { valid: false }

  const [userId, expiresAtStr, sig] = parts
  const expiresAt = parseInt(expiresAtStr, 10)
  if (isNaN(expiresAt) || expiresAt < Date.now()) {
    return { valid: false }
  }

  const expectedSig = await signData(`${userId}.${expiresAtStr}`, secret)
  if (expectedSig !== sig) {
    return { valid: false }
  }

  return { valid: true, userId }
}

export function setAuthCookie(c: Context, tokenValue: string) {
  const isHttps = c.req.url.startsWith('https://')
  setCookie(c, COOKIE_NAME, tokenValue, {
    path: '/',
    maxAge: SESSION_MAX_AGE,
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps,
  })
}

export function clearAuthCookie(c: Context) {
  deleteCookie(c, COOKIE_NAME, { path: '/' })
}

export function getAuthCookie(c: Context): string | undefined {
  return getCookie(c, COOKIE_NAME)
}

export async function ensureDefaultUser(db: ReturnType<typeof drizzle>) {
  try {
    await db
      .insert(users)
      .values({
        id: DEFAULT_USER.id,
        name: DEFAULT_USER.name,
        email: DEFAULT_USER.email,
        emailVerified: true,
      })
      .onConflictDoNothing()
  } catch {
    // ignore
  }
}
