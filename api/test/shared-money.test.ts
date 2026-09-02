import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The API and the register compute totals with the SAME code — pinned here.
 * The only permitted difference is the ESM import suffix Node needs.
 */
const pairs = ['money', 'totals', 'pricing']

describe('shared money code is byte-identical to the frontend', () => {
  for (const name of pairs) {
    it(name, () => {
      const app = readFileSync(new URL(`../../app/src/lib/${name}.ts`, import.meta.url), 'utf8')
      const api = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8')
      expect(api.replace("from './money.js'", "from './money'")).toBe(app)
    })
  }
})
