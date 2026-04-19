import { describe, it, expect, beforeEach } from 'vitest'
import {
  isSafeExternalUrl,
  isSameOrigin,
  canOpenExternalNow,
  __resetExternalOpenRateLimitForTests,
} from '../../src/main/security'

describe('isSafeExternalUrl', () => {
  it('allows http and https URLs', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('https://example.com/path')).toBe(true)
  })

  it('blocks mailto: (can be abused to exfiltrate data via default mail client)', () => {
    expect(isSafeExternalUrl('mailto:user@example.com')).toBe(false)
  })

  it('blocks file://', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
  })

  it('blocks javascript:', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('blocks data:', () => {
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
  })
})

describe('isSameOrigin', () => {
  it('treats trailing-slash and no-slash URLs as same origin', () => {
    expect(isSameOrigin('file:///app/index.html', 'file:///app/index.html/')).toBe(true)
  })

  it('treats URLs with different fragments as same origin', () => {
    expect(isSameOrigin('http://localhost:5173/a#x', 'http://localhost:5173/a#y')).toBe(true)
  })

  it('rejects cross-origin navigation', () => {
    expect(isSameOrigin('https://evil.example/', 'file:///app/index.html')).toBe(false)
    expect(isSameOrigin('http://localhost:5174/', 'http://localhost:5173/')).toBe(false)
  })

  it('rejects cross-path file:// URLs (regression for file-origin collapse)', () => {
    // new URL('file:///*').origin is literally 'null', so raw origin comparison
    // treats every file:// URL as same-origin. isSameOrigin must compare paths
    // for the file: scheme so a compromised renderer cannot navigate to an
    // arbitrary local file (e.g. file:///etc/passwd).
    expect(isSameOrigin('file:///etc/passwd', 'file:///app/renderer/index.html')).toBe(false)
    expect(isSameOrigin('file:///C:/Windows/System32/hosts', 'file:///app/renderer/index.html')).toBe(
      false
    )
    // Same file, differing fragments / trailing slashes — still allowed.
    expect(isSameOrigin('file:///app/renderer/index.html#a', 'file:///app/renderer/index.html')).toBe(
      true
    )
  })

  it('returns false for malformed URLs rather than throwing', () => {
    expect(isSameOrigin('not a url', 'file:///app/index.html')).toBe(false)
    expect(isSameOrigin('', '')).toBe(false)
  })
})

describe('canOpenExternalNow — sliding-window rate limit', () => {
  beforeEach(() => {
    __resetExternalOpenRateLimitForTests()
  })

  it('allows up to 10 calls inside a 10-second window', () => {
    for (let i = 0; i < 10; i++) {
      expect(canOpenExternalNow(0)).toBe(true)
    }
  })

  it('rejects the 11th call at the same instant', () => {
    for (let i = 0; i < 10; i++) canOpenExternalNow(0)
    // All 10 slots consumed — 11th must return false to block the renderer
    // from spamming shell.openExternal.
    expect(canOpenExternalNow(0)).toBe(false)
  })

  it('allows a new call after the window slides past the oldest timestamp', () => {
    for (let i = 0; i < 10; i++) canOpenExternalNow(0)
    // At t=10s+1ms, the slot at t=0 is outside the 10s window; the call is
    // permitted.
    expect(canOpenExternalNow(10_001)).toBe(true)
  })
})
