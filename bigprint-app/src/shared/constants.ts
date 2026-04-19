export type PaperSize = {
  id: string
  label: string
  widthMm: number
  heightMm: number
}

export const PAPER_SIZES: PaperSize[] = [
  { id: 'letter', label: 'Letter (8.5 × 11")', widthMm: 215.9, heightMm: 279.4 },
  { id: 'legal', label: 'Legal (8.5 × 14")', widthMm: 215.9, heightMm: 355.6 },
  { id: 'tabloid', label: 'Tabloid (11 × 17")', widthMm: 279.4, heightMm: 431.8 },
  { id: 'a4', label: 'A4 (210 × 297 mm)', widthMm: 210.0, heightMm: 297.0 },
  { id: 'a3', label: 'A3 (297 × 420 mm)', widthMm: 297.0, heightMm: 420.0 },
  { id: 'a5', label: 'A5 (148 × 210 mm)', widthMm: 148.0, heightMm: 210.0 },
]

export const PAPER_SIZE_MAP: Record<string, PaperSize> = Object.fromEntries(PAPER_SIZES.map(p => [p.id, p]))

export const SUPPORTED_INPUT_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.gif',
  '.webp',
  '.tiff',
  '.tif',
  '.svg',
  '.pdf',
  '.avif',
]

export const MAX_PREVIEW_SIZE_PX = 2048
export const MAX_SOURCE_IMAGE_PX = 20000

// JPEG quality used for per-tile embedded images in exported PDFs and for the
// internal buffer in applyInkSaver. 95 balances size vs. fidelity for printed
// output; anything lower produces visible blocking on fine grid lines.
export const JPEG_TILE_QUALITY = 95

// Minimum DPI used when rasterising a PDF source for export/print. 96 DPI
// produces ~816×1056 px for Letter which upscales ~3× on a 300 DPI printer,
// so we clamp up to 300 before feeding the rasteriser.
export const MIN_PRINT_DPI = 300

// Density (DPI) used by Sharp when rasterising a PDF page for the preview
// thumbnail. 150 gives ~1200×1550 px on Letter — good preview fidelity
// without excessive memory pressure.
export const PDF_PREVIEW_DENSITY = 150

// Scale factor for PDF.js page rendering in the renderer-side preview hook.
// 1.5× yields ~918×1188 px for Letter at 72-pt page size — balances quality
// vs. memory for the preview canvas.
export const PDFJS_PREVIEW_SCALE = 1.5

// Per-session cap on the number of files the renderer may register for
// read-back (drag-drop / clipboard flow). Prevents a compromised renderer from
// admitting thousands of paths to the allowlist.
export const MAX_REGISTER_PER_SESSION = 50

// Per-file byte cap for both file:register and the pdf:* IPC channels.
// A file above this size is rejected at registration / read time.
export const MAX_REGISTER_BYTES = 500 * 1024 * 1024 // 500 MB

// Shared mm ↔ PDF point constant. 1 pt = 1/72 inch, 1 inch = 25.4 mm.
// Derived (not a literal) so every consumer sees full IEEE-754 precision.
export const MM_TO_PT = 72 / 25.4

// Fallback paper size used when the requested id is unknown AND the PAPER_SIZES
// array is somehow empty (defensive — the array literal guarantees letter at
// index 0 today, but noUncheckedIndexedAccess now types [0] as possibly undefined).
const FALLBACK_PAPER: PaperSize = { id: 'letter', label: 'Letter', widthMm: 215.9, heightMm: 279.4 }

export function getPaperSize(
  id: string,
  orientation: 'portrait' | 'landscape'
): { widthMm: number; heightMm: number } {
  const p = PAPER_SIZE_MAP[id] ?? PAPER_SIZES[0] ?? FALLBACK_PAPER
  if (orientation === 'portrait') return { widthMm: p.widthMm, heightMm: p.heightMm }
  return { widthMm: p.heightMm, heightMm: p.widthMm }
}
