export type PaperSize = {
  id: string
  label: string
  widthMm: number
  heightMm: number
}

export const PAPER_SIZES: PaperSize[] = [
  { id: 'letter',  label: 'Letter (8.5 × 11")', widthMm: 215.9, heightMm: 279.4 },
  { id: 'legal',   label: 'Legal (8.5 × 14")',  widthMm: 215.9, heightMm: 355.6 },
  { id: 'tabloid', label: 'Tabloid (11 × 17")', widthMm: 279.4, heightMm: 431.8 },
  { id: 'a4',      label: 'A4 (210 × 297 mm)',  widthMm: 210.0, heightMm: 297.0 },
  { id: 'a3',      label: 'A3 (297 × 420 mm)',  widthMm: 297.0, heightMm: 420.0 },
  { id: 'a5',      label: 'A5 (148 × 210 mm)',  widthMm: 148.0, heightMm: 210.0 },
]

export const PAPER_SIZE_MAP: Record<string, PaperSize> = Object.fromEntries(
  PAPER_SIZES.map(p => [p.id, p])
)

export const SUPPORTED_INPUT_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp', '.tiff', '.tif', '.svg', '.pdf'
]

export const MAX_PREVIEW_SIZE_PX = 2048
export const MAX_SOURCE_IMAGE_PX = 20000

export function getPaperSize(id: string, orientation: 'portrait' | 'landscape'): { widthMm: number; heightMm: number } {
  const p = PAPER_SIZE_MAP[id] ?? PAPER_SIZES[0]
  if (orientation === 'portrait') return { widthMm: p.widthMm, heightMm: p.heightMm }
  return { widthMm: p.heightMm, heightMm: p.widthMm }
}
