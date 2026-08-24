import { http, HttpResponse, delay } from 'msw'
import type { Role } from '../api/types'

/**
 * Phase 0 mock world. Mirrors the seed data the backend's seed script will
 * create, so switching the mocks off later changes nothing visible.
 * Demo password for every user: demo123
 */
interface SeedUser {
  id: string
  name: string
  email: string
  role: Role
  business_id: string
  store_id: string | null
  store_name: string | null
  password: string
}

const users: SeedUser[] = [
  {
    id: 'u-sara',
    name: 'Sara Al-Ali',
    email: 'sara@alrayyan-market.qa',
    role: 'cashier',
    business_id: 'b-demo',
    store_id: 's-alrayyan',
    store_name: 'Al Rayyan Store',
    password: 'demo123',
  },
  {
    id: 'u-yusuf',
    name: 'Yusuf Khan',
    email: 'yusuf@karakcorner.qa',
    role: 'cashier',
    business_id: 'b-demo',
    store_id: 's-karak',
    store_name: 'Karak Corner',
    password: 'demo123',
  },
  {
    id: 'u-ayaan',
    name: 'Ayaan Hydross',
    email: 'owner@agricope.qa',
    role: 'owner',
    business_id: 'b-demo',
    store_id: null,
    store_name: null,
    password: 'demo123',
  },
]

export const handlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    await delay(400)
    const body = (await request.json()) as { email?: string; password?: string }
    const user = users.find((u) => u.email === body.email)
    if (!user || user.password !== body.password) {
      return HttpResponse.json(
        { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } },
        { status: 401 },
      )
    }
    const { password: _password, ...publicUser } = user
    return HttpResponse.json({
      access_token: `mock-jwt.${user.id}`,
      refresh_token: `mock-refresh.${user.id}`,
      user: publicUser,
    })
  }),
]
