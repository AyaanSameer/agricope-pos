/**
 * A branch's short name — the part after the business.
 *
 * Stores are named "<Business> — <Branch>" so a name reads on its own in a
 * tenant list. Inside one business the prefix is the same on every row, so a
 * table repeats it down the column and pushes the part that differs out of
 * view. Back-office tables want the branch alone.
 *
 * Anything without the separator is already short, and comes back untouched —
 * "Karak Corner", "All branches".
 */
export function shortBranch(name: string | null | undefined): string {
  if (!name) return ''
  const parts = name.split(/\s+[—–]\s+/)
  return (parts.length > 1 ? parts[parts.length - 1] : name).trim()
}
