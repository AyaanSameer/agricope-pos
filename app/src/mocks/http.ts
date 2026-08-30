import { HttpResponse } from 'msw'
import type { Role } from '../api/types'
import { requester } from './db'
import type { DbUser } from './db'

/**
 * The helpers every mock handler file shares: the one error shape, and the
 * two ways of resolving who is calling. Domain-specific guards (approval
 * PINs, order visibility) live with their domain instead.
 */

/** The API's one error envelope — { error: { code, message } }. */
export function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status })
}

/** The signed-in person behind a request, or null. */
export function auth(request: Request): DbUser | null {
  return requester(request)
}

/** The signed-in person, required to hold one of the given roles. */
export function requireRole(request: Request, roles: Role[]): DbUser | Response {
  const user = requester(request)
  if (!user) return apiError(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  if (!roles.includes(user.role)) {
    return apiError(403, 'FORBIDDEN', 'You do not have permission to do this.')
  }
  return user
}
