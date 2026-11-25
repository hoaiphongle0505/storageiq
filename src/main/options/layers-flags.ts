/**
 * The AppCompatFlags `Layers` value is a space-separated list: an optional leading `~` and then
 * compatibility flags. These two functions add or remove only `RUNASADMIN` and never rewrite the
 * other flags.
 */
const FLAG = 'RUNASADMIN'

const tokensOf = (value: string | null): string[] =>
  (value ?? '').split(/\s+/).filter((token) => token !== '')

const isFlag = (token: string) => token.toUpperCase() === FLAG

/** The value with `RUNASADMIN` set; a value that already has the flag is returned unchanged. */
export function addRunAsAdmin(existing: string | null): string {
  const tokens = tokensOf(existing)
  if (tokens.length === 0) return `~ ${FLAG}`
  if (tokens.some(isFlag)) return existing ?? ''
  return [...tokens, FLAG].join(' ')
}

/** The value without `RUNASADMIN`; null means nothing is left and the value should be deleted. */
export function removeRunAsAdmin(existing: string | null): string | null {
  const rest = tokensOf(existing).filter((token) => !isFlag(token))
  if (rest.length === 0 || (rest.length === 1 && rest[0] === '~')) return null
  return rest.join(' ')
}
