import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { applyInkSaver } from '../../src/main/image/InkSaver'

async function makeJpeg(width = 4, height = 4): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .jpeg({ quality: 95 })
    .toBuffer()
}

describe('applyInkSaver', () => {
  it('returns the same Buffer reference when disabled — no re-encode', async () => {
    const input = await makeJpeg()
    const out = await applyInkSaver({
      inputBuffer: input,
      widthPx: 4,
      heightPx: 4,
      pxPerMm: 4,
      settings: {
        enabled: false,
        brightness: 100,
        gamma: 1,
        edgeFadeStrength: 0,
        edgeFadeRadiusMm: 0,
      },
    })
    expect(out).toBe(input)
  })

  it('preserves dimensions with no-op settings while enabled', async () => {
    const input = await makeJpeg(8, 6)
    const out = await applyInkSaver({
      inputBuffer: input,
      widthPx: 8,
      heightPx: 6,
      pxPerMm: 4,
      settings: {
        enabled: true,
        brightness: 100,
        gamma: 1,
        edgeFadeStrength: 0,
        edgeFadeRadiusMm: 0,
      },
    })
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(8)
    expect(meta.height).toBe(6)
  })
})
