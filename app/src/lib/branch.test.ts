import { describe, expect, it } from 'vitest'
import { shortBranch } from './branch'

describe('shortBranch', () => {
  it('drops the business a branch belongs to', () => {
    expect(shortBranch('Drumsticks — Barwa Village')).toBe('Barwa Village')
    expect(shortBranch('Mazzraty Market — Al Wakra')).toBe('Al Wakra')
  })

  it('leaves a name that has no business prefix alone', () => {
    expect(shortBranch('Karak Corner')).toBe('Karak Corner')
    expect(shortBranch('All branches')).toBe('All branches')
  })

  it('takes the last part when the branch itself has a dash', () => {
    expect(shortBranch('Drumsticks — Lusail — Marina')).toBe('Marina')
  })

  // A hyphenated place name is not a separator.
  it('does not split on a hyphen inside a word', () => {
    expect(shortBranch('Al-Rayyan Store')).toBe('Al-Rayyan Store')
  })

  it('handles nothing', () => {
    expect(shortBranch(null)).toBe('')
    expect(shortBranch(undefined)).toBe('')
  })
})
