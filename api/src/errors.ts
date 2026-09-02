import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

/**
 * The one error shape on the wire — { error: { code, message } } — with a
 * status the client can act on. Codes are the vocabulary CONVENTIONS.md
 * fixes; the frontend switches on them (APPROVAL_REQUIRED opens the PIN pad).
 */
export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export const unauthenticated = (message = 'Sign in to continue.') =>
  new ApiError(401, 'UNAUTHENTICATED', message)
export const forbidden = (message = 'You do not have permission to do this.') =>
  new ApiError(403, 'FORBIDDEN', message)
export const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `No such ${what}.`)
export const invalid = (message: string) => new ApiError(400, 'VALIDATION_ERROR', message)
export const conflict = (code: string, message: string) => new ApiError(409, code, message)
export const approvalRequired = (message = 'A manager PIN is needed to approve this.') =>
  new ApiError(403, 'APPROVAL_REQUIRED', message)

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ApiError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message } })
  }
  if (err instanceof ZodError) {
    const first = err.issues[0]
    const where = first?.path.length ? `${first.path.join('.')}: ` : ''
    return reply
      .status(400)
      .send({ error: { code: 'VALIDATION_ERROR', message: `${where}${first?.message ?? 'Invalid input.'}` } })
  }
  const fe = err as FastifyError
  if (fe.statusCode === 429) {
    return reply.status(429).send({
      error: { code: 'RATE_LIMITED', message: 'Too many attempts — wait a minute and try again.' },
    })
  }
  if (fe.validation) {
    return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: fe.message } })
  }
  req.log.error({ err }, 'unhandled error')
  return reply
    .status(500)
    .send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } })
}
