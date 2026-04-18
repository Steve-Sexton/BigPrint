import { describe, it, expect } from 'vitest'
import { isSafeExternalUrl, isSameOrigin } from '../../src/main/security'

describe('isSafeExternalUrl', () => {
  it('allows http and https URLs', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('https://example.com/path')).toBe(true)
  })

  it('allows mailto:', () => {
    expect(isSafeExternalUrl('mailto:user@example.com')).toBe(true)
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

  it('returns false for malformed URLs rather than throwing', () => {
    expect(isSameOrigin('not a url', 'file:///app/index.html')).toBe(false)
    expect(isSameOrigin('', '')).toBe(false)
  })
})
