/**
 * The one place the app talks HTTP. Attaches the JWT, unwraps the standard
 * error shape { error: { code, message } }, and hands typed JSON back.
 */
const BASE = '/api/v1'

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  const res = await fetch(`${BASE}${path}`, { ...init, headers })

  if (!res.ok) {
    let code = 'UNKNOWN'
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) {
        code = body.error.code ?? code
        message = body.error.message ?? message
      }
    } catch {
      /* non-JSON error body — keep the fallback */
    }
    throw new ApiError(code, message, res.status)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
