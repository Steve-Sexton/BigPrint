import sharp from 'sharp'
import type { InkSaverSettings } from '../../shared/ipc-types'

export interface InkSaverInput {
  inputBuffer: Buffer
  widthPx: number
  heightPx: number
  /** Pixels per millimetre of the INPUT BUFFER (not the source image).
   *  Used to convert `edgeFadeRadiusMm` → px directly and correctly regardless
   *  of how many times the buffer has been rescaled upstream. */
  pxPerMm: number
  settings: InkSaverSettings
}

// Detect output format from the input buffer's magic bytes.
// JPEG: 0xff 0xd8  |  PNG: 0x89 0x50  |  everything else → PNG (safe fallback)
function detectOutputFormat(buf: Buffer): 'jpeg' | 'png' {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg'
  return 'png'
}

function encodeOutput(pipeline: sharp.Sharp, format: 'jpeg' | 'png'): sharp.Sharp {
  return format === 'jpeg' ? pipeline.jpeg({ quality: 95 }) : pipeline.png()
}

export async function applyInkSaver(input: InkSaverInput): Promise<Buffer> {
  const { inputBuffer, widthPx, heightPx, pxPerMm, settings } = input

  if (!settings.enabled) return inputBuffer

  const outputFormat = detectOutputFormat(inputBuffer)
  let pipeline = sharp(inputBuffer)

  // Step 1: Brightness (linear multiplier via modulate)
  if (settings.brightness !== 100) {
    pipeline = pipeline.modulate({ brightness: settings.brightness / 100 })
  }

  // Step 2: Gamma — lightens midtones when > 1.0, preserves pure black
  if (settings.gamma !== 1.0) {
    pipeline = pipeline.gamma(Math.max(1.0, Math.min(3.0, settings.gamma)))
  }

  // Step 3: Edge-aware fading
  if (settings.edgeFadeStrength > 0 && widthPx > 0 && heightPx > 0) {
    return applyEdgeFade(pipeline, widthPx, heightPx, pxPerMm, settings, outputFormat)
  }

  return encodeOutput(pipeline, outputFormat).toBuffer()
}

async function applyEdgeFade(
  basePipeline: sharp.Sharp,
  widthPx: number,
  heightPx: number,
  pxPerMm: number,
  settings: InkSaverSettings,
  outputFormat: 'jpeg' | 'png'
): Promise<Buffer> {
  const strength = settings.edgeFadeStrength / 100
  // Convert mm radius → buffer pixels directly. pxPerMm is measured on the
  // input buffer so the same physical radius yields consistent blur regardless
  // of upstream rescaling.
  const blurRadius = Math.max(1, Math.round(settings.edgeFadeRadiusMm * pxPerMm))

  // Compute Sobel edge map from grayscale version.
  // offset: 128 shifts the convolution output so that negative gradients are
  // preserved as values below 128 rather than being clamped to 0 by Sharp.
  // The magnitude loop then re-centers with (buf[i] - 128).
  const grayBuf = await basePipeline.clone()
    .grayscale()
    .raw()
    .toBuffer()

  const sobelXBuf = await sharp(grayBuf, { raw: { width: widthPx, height: heightPx, channels: 1 } })
    .convolve({ width: 3, height: 3, kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1], scale: 1, offset: 128 })
    .raw()
    .toBuffer()

  const sobelYBuf = await sharp(grayBuf, { raw: { width: widthPx, height: heightPx, channels: 1 } })
    .convolve({ width: 3, height: 3, kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1], scale: 1, offset: 128 })
    .raw()
    .toBuffer()

  // Gradient magnitude → edge map
  const edgeMap = Buffer.alloc(widthPx * heightPx)
  for (let i = 0; i < edgeMap.length; i++) {
    const gx = (sobelXBuf[i] ?? 128) - 128
    const gy = (sobelYBuf[i] ?? 128) - 128
    edgeMap[i] = Math.min(255, Math.sqrt(gx * gx + gy * gy) * 2)
  }

  // Blur edge map — creates smooth proximity falloff
  const blurredEdge = await sharp(edgeMap, { raw: { width: widthPx, height: heightPx, channels: 1 } })
    .blur(blurRadius)
    .raw()
    .toBuffer()

  // Get original pixels
  const { data: origData, info } = await basePipeline.clone()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const channels = info.channels
  const result = Buffer.alloc(origData.length)

  for (let i = 0; i < widthPx * heightPx; i++) {
    const edgeProx = (blurredEdge[i] ?? 0) / 255
    const maskAlpha = 1 - (1 - edgeProx) * strength

    for (let c = 0; c < channels; c++) {
      if (c === 3) {
        result[i * channels + c] = origData[i * channels + c]!
      } else {
        const orig = origData[i * channels + c]!
        result[i * channels + c] = Math.round(orig * maskAlpha + 255 * (1 - maskAlpha))
      }
    }
  }

  return encodeOutput(
    sharp(result, { raw: { width: widthPx, height: heightPx, channels } }),
    outputFormat
  ).toBuffer()
}
