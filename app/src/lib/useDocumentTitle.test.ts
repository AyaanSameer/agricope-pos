import { describe, expect, it } from 'vitest'
import { titleFor } from './useDocumentTitle'

const till = { admin: false, business: 'Drumsticks', store: 'Drumsticks — Barwa Village' }

describe('titleFor', () => {
  it('names the branch the till is signed into', () => {
    expect(titleFor('/register', till)).toBe('Drumsticks — Barwa Village')
    expect(titleFor('/', till)).toBe('Drumsticks — Barwa Village')
  })
  it('falls back to the business while a branch is still being picked', () => {
    expect(titleFor('/pick-store', { ...till, store: null })).toBe('Drumsticks')
  })
  it('keeps the product name on login and the public receipt', () => {
    expect(titleFor('/login', till)).toBe('Agricope POS')
    expect(titleFor('/r/abc123', till)).toBe('Agricope POS')
  })
  it('names the console for a platform admin', () => {
    expect(titleFor('/admin', { admin: true, business: null, store: null })).toBe('Agricope Console')
  })
  it('does not call a business till the console just because the path says admin', () => {
    expect(titleFor('/admin', till)).toBe('Drumsticks — Barwa Village')
  })
  it('is the product name with nobody signed in', () => {
    expect(titleFor('/', { admin: false, business: null, store: null })).toBe('Agricope POS')
  })
})
