// Small security-focused helpers shared by the main process. Kept here rather
// than in main/index.ts so that unit tests can import them without triggering
// the electron app bootstrap side effects.

const ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:'])

/**
 * Returns true only when `url` uses a scheme safe to hand to
 * shell.openExternal. Blocks file://, javascript:, data:, mailto:, and any
 * custom protocol that a compromised renderer could use to pivot beyond the
 * sandbox (mailto: in particular can be abused to pre-fill user data into the
 * default mail client; the app never legitimately opens mail links).
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol)
  } catch {
    return false
  }
}

// Rate-limit window for shell.openExternal calls. A compromised renderer
// otherwise could spam the default browser with tab/window opens.
const EXTERNAL_OPEN_WINDOW_MS = 10_000
const EXTERNAL_OPEN_MAX = 10
const externalOpenTimestamps: number[] = []

/** Returns true if another shell.openExternal is allowed right now. */
export function canOpenExternalNow(nowMs: number = Date.now()): boolean {
  // Drop timestamps outside the sliding window.
  while (externalOpenTimestamps.length > 0) {
    const oldest = externalOpenTimestamps[0]
    if (oldest === undefined || nowMs - oldest <= EXTERNAL_OPEN_WINDOW_MS) break
    externalOpenTimestamps.shift()
  }
  if (externalOpenTimestamps.length >= EXTERNAL_OPEN_MAX) return false
  externalOpenTimestamps.push(nowMs)
  return true
}

/** Exposed for unit tests. */
export function __resetExternalOpenRateLimitForTests(): void {
  externalOpenTimestamps.length = 0
}

/**
 * Same-origin check used by the will-navigate guard. Compares parsed origins
 * instead of raw strings so trailing slashes, fragments, and query-string
 * differences don't cause false blocks/allows.
 *
 * Special-cased for `file:` URLs: in Node/Electron `new URL('file:///any').origin`
 * is the string "null", so every `file://` URL collapses to a single origin.
 * Raw origin comparison would let a compromised renderer navigate from
 * `file:///app/renderer/index.html` to `file:///etc/passwd`. For the `file:`
 * scheme we therefore compare the pathname directly (trailing-slash tolerant).
 */
export function isSameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    if (ua.protocol !== ub.protocol) return false
    if (ua.protocol === 'file:') {
      const normalize = (p: string): string => p.replace(/\/+$/, '')
      return normalize(ua.pathname) === normalize(ub.pathname)
    }
    return ua.origin === ub.origin
  } catch {
    return false
  }
}
