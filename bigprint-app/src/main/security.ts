// Small security-focused helpers shared by the main process. Kept here rather
// than in main/index.ts so that unit tests can import them without triggering
// the electron app bootstrap side effects.

const ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * Returns true only when `url` uses a scheme safe to hand to
 * shell.openExternal. Blocks file://, javascript:, data:, and any custom
 * protocol that a compromised renderer could use to pivot beyond the sandbox.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol)
  } catch {
    return false
  }
}
