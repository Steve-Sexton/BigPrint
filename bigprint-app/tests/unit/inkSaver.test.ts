import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { applyInkSaver } from '../../src/main/image/InkSaver'

// Build a 40×40 JPEG with a 2-px-wide black vertical stripe down the center,
// everything else mid-gray. Used by the edge-fade tests.
async function makeStripedJpeg(): Promise<Buffer> {
  const w = 40, h = 40
  const buf = Buffer.alloc(w * h * 3, 128)
  for (let y = 0; y < h; y++) {
    for (let dx = 0; dx < 2; dx++) {
      const i = (y * w + (19 + dx)) * 3
      buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer()
}

// Read the R channel at (x, y) from a PNG/JPEG buffer.
async function sampleR(buf: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const idx = (y * info.width + x) * info.channels
  return data[idx] ?? -1
}

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

  it('edge-fade lightens flat regions away from lines', async () => {
    const input = await makeStripedJpeg()
    const out = await applyInkSaver({
      inputBuffer: input,
      widthPx: 40,
      heightPx: 40,
      pxPerMm: 4,  // radius 1 mm → 4 px blur
      settings: {
        enabled: true, brightness: 100, gamma: 1,
        edgeFadeStrength: 100, edgeFadeRadiusMm: 1,
      },
    })
    // A pixel far from the center stripe should lighten well past mid-gray.
    // With strength=100 the flat interior collapses toward white — require it
    // to be substantially brighter than the 128 midpoint.
    //
    // Regression guard for the Sobel `offset: 128` fix: with the old `offset: 0`
    // the convolution clamped negative gradients to 0, leaving the edge map
    // incorrectly saturated across flat regions. The maskAlpha would stay
    // near 1, and flat gray would pass through unchanged (farR ≈ 128). The
    // `> 200` bound would fail under that regression.
    const farR = await sampleR(out, 2, 2)
    expect(farR).toBeGreaterThan(200)
  })

  it('edge-fade alters output materially vs strength=0 on the same source', async () => {
    const input = await makeStripedJpeg()
    const common = {
      inputBuffer: input, widthPx: 40, heightPx: 40, pxPerMm: 4,
    }
    const baseline = await applyInkSaver({
      ...common,
      settings: {
        enabled: true, brightness: 100, gamma: 1,
        edgeFadeStrength: 0, edgeFadeRadiusMm: 1,
      },
    })
    const faded = await applyInkSaver({
      ...common,
      settings: {
        enabled: true, brightness: 100, gamma: 1,
        edgeFadeStrength: 100, edgeFadeRadiusMm: 1,
      },
    })
    // Pick a pixel in the flat region — the faded output must be meaningfully
    // brighter than the strength=0 baseline (which returned the source buffer
    // largely untouched).
    const baselineR = await sampleR(baseline, 2, 2)
    const fadedR = await sampleR(faded, 2, 2)
    expect(fadedR).toBeGreaterThan(baselineR + 50)
  })
})
