import { describe, it, expect } from 'vitest'
import { isSafeExternalUrl } from '../../src/main/security'

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
