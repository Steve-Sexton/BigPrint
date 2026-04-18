import sharp from 'sharp'
import path from 'path'
import fs from 'fs'
import { PDFDocument } from 'pdf-lib'
import type { ImageMetaResult } from '../../shared/ipc-types'
import { MAX_PREVIEW_SIZE_PX, MAX_SOURCE_IMAGE_PX } from '../../shared/constants'

// ── PDF metadata ──────────────────────────────────────────────────────────────
async function getPDFMeta(filePath: string): Promise<ImageMetaResult> {
  // Try Sharp first (works when libvips has poppler, e.g. Linux/macOS)
  try {
    const meta = await sharp(filePath, { page: 0, density: 72 }).metadata()
    return {
      widthPx: meta.width ?? 612,
      heightPx: meta.height ?? 792,
      dpiX: meta.density ?? 72,
      dpiY: meta.density ?? 72,
      format: 'pdf',
      hasAlpha: false
    }
  } catch { /* fall through to pdf-lib */ }

  // Fallback: parse page dimensions directly from the PDF structure using pdf-lib.
  // Works without poppler and returns the correct size for ANY page — not just
  // standard Letter.  PDF dimensions are in points (1 pt = 1/72 inch).
  try {
    const bytes = fs.readFileSync(filePath)
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const page = doc.getPage(0)
    const { width, height } = page.getSize()  // points
    return {
      widthPx: Math.round(width),             // 1 pt = 1 px at 72 DPI
      heightPx: Math.round(height),
      dpiX: 72,
      dpiY: 72,
      format: 'pdf',
      hasAlpha: false
    }
  } catch {
    // Last-resort — Letter at 72 DPI
    return { widthPx: 612, heightPx: 792, dpiX: 72, dpiY: 72, format: 'pdf', hasAlpha: false }
  }
}

// ── SVG metadata (parse viewBox / width / height attributes) ─────────────────
async function getSVGMeta(filePath: string): Promise<ImageMetaResult> {
  try {
    // Attempt Sharp first — works when librsvg is available
    const meta = await sharp(filePath).metadata()
    if (meta.width && meta.height) {
      return {
        widthPx: meta.width,
        heightPx: meta.height,
        dpiX: meta.density ?? 96,
        dpiY: meta.density ?? 96,
        format: 'svg',
        hasAlpha: true
      }
    }
  } catch { /* fall through to manual parse */ }

  // Manual parse: read SVG file and pull width/height from root element.
  // If reading the file fails outright (deleted / permission denied), return
  // the zero-dimension sentinel so Toolbar.handleOpen surfaces the error to
  // the user instead of rendering an 800×600 phantom placeholder.
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8').slice(0, 4096)
  } catch {
    return { widthPx: 0, heightPx: 0, dpiX: null, dpiY: null, format: 'svg', hasAlpha: true }
  }

  const vbMatch = content.match(/viewBox\s*=\s*["'][\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)["']/)
  const wMatch  = content.match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/)
  const hMatch  = content.match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/)

  const w = wMatch  ? parseFloat(wMatch[1])  : (vbMatch ? parseFloat(vbMatch[1]) : 800)
  const h = hMatch  ? parseFloat(hMatch[1])  : (vbMatch ? parseFloat(vbMatch[2]) : 600)

  return { widthPx: Math.round(w), heightPx: Math.round(h), dpiX: 96, dpiY: 96, format: 'svg', hasAlpha: true }
}

// ── Main entry points ─────────────────────────────────────────────────────────

export async function getImageMeta(filePath: string): Promise<ImageMetaResult> {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.pdf') return getPDFMeta(filePath)
  if (ext === '.svg') return getSVGMeta(filePath)

  // Standard raster image (JPEG, PNG, TIFF, WebP, BMP, GIF, AVIF …)
  // Wrapped in try/catch so exotic or corrupted formats degrade gracefully
  // instead of crashing the IPC handler.
  try {
    const meta = await sharp(filePath).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    // Reject sources so large that downstream Sharp operations would exhaust
    // memory. MAX_SOURCE_IMAGE_PX applies to each dimension independently.
    if (w > MAX_SOURCE_IMAGE_PX || h > MAX_SOURCE_IMAGE_PX) {
      console.warn(`[ImagePipeline] Image exceeds ${MAX_SOURCE_IMAGE_PX}px on an axis (${w}×${h}); refusing to load`)
      return { widthPx: 0, heightPx: 0, dpiX: null, dpiY: null, format: meta.format ?? 'unknown', hasAlpha: meta.hasAlpha ?? false }
    }
    return {
      widthPx:  w,
      heightPx: h,
      dpiX: meta.density ?? null,
      dpiY: meta.density ?? null,
      format: meta.format ?? 'unknown',
      hasAlpha: meta.hasAlpha ?? false
    }
  } catch (err) {
    // Unknown / unsupported format — return zeroed metadata so the UI can
    // show a meaningful error rather than a silent crash.
    console.warn(`[ImagePipeline] getImageMeta failed for "${filePath}":`, err)
    return { widthPx: 0, heightPx: 0, dpiX: null, dpiY: null, format: ext.slice(1) || 'unknown', hasAlpha: false }
  }
}

export async function getPreviewDataUrl(
  filePath: string,
  maxSizePx: number = MAX_PREVIEW_SIZE_PX
): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.pdf') {
    // Rasterise first page via Sharp (needs poppler).  Returns '' if unavailable.
    try {
      const buf = await sharp(filePath, { page: 0, density: 150 })
        .png()
        .toBuffer()
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      return ''
    }
  }

  // For SVG and raster images: let Sharp normalise.
  // Wrapped in try/catch so unsupported formats return '' gracefully.
  try {
    const meta = await sharp(filePath).metadata()
    const w = meta.width  ?? 1
    const h = meta.height ?? 1

    const scale   = Math.min(1, maxSizePx / Math.max(w, h))
    const targetW = Math.max(1, Math.round(w * scale))
    const targetH = Math.max(1, Math.round(h * scale))

    const buffer = await sharp(filePath)
      .resize(targetW, targetH, { fit: 'fill' })
      .png()
      .toBuffer()

    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch (err) {
    console.warn(`[ImagePipeline] getPreviewDataUrl failed for "${filePath}":`, err)
    return ''
  }
}

export function getSupportedMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.bmp': 'image/bmp',
    '.gif': 'image/gif', '.webp': 'image/webp',
    '.tiff': 'image/tiff', '.tif': 'image/tiff',
    '.avif': 'image/avif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf'
  }
  return map[ext] ?? 'application/octet-stream'
}
