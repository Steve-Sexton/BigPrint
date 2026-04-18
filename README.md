# BigPrint — Poster & Template Tiling App

A modern cross-platform desktop app for tiling large images and PDFs across standard printer pages with alignment aids, ink saving, and direct printing.

## Prerequisites

- **Node.js 20 or 22** (LTS recommended) — https://nodejs.org
- **Windows, macOS (Intel or Apple Silicon), or Linux**
- Python 3 + build tools for native modules (Sharp):
  - **Windows**: `npm install -g windows-build-tools` OR install Visual Studio Build Tools
  - **macOS**: Xcode command line tools (`xcode-select --install`)
  - **Linux**: `sudo apt install build-essential python3`

## Quick Start

```bash
# 1. Install dependencies (downloads Electron binary ~120MB, may take a minute)
npm install

# 2. Start the development server
npm run dev
```

The app window should open automatically. If Electron shows a blank screen, wait a moment for the Vite dev server to warm up — it hot-reloads on save.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot-reload (development) |
| `npm run build` | Build for production |
| `npm run dist` | Build + package as installer (.exe / .dmg / .AppImage) |
| `npm test` | Run unit tests (Vitest) |

## Sharp Native Module

Sharp is used for image processing in the main process. After `npm install`, it should be rebuilt automatically for Electron's Node.js version via the `postinstall` script. If you see Sharp-related errors:

```bash
# Manually rebuild Sharp for Electron
npx electron-rebuild -f -w sharp
```

## Troubleshooting

**"Electron failed to install correctly"**
→ Delete `node_modules` and run `npm install` again. Check your internet connection.

**"Cannot find module 'sharp'"**
→ Run `npx electron-rebuild -f -w sharp`

**App opens but shows blank canvas**
→ Drop an image file onto the window or click Open to load a file.

**PDF export fails**
→ Ensure you have write permission to the output directory.

## Architecture

```
src/
├── main/          Node.js process (Electron main)
│   ├── ipc/       IPC channel handlers
│   ├── image/     Sharp-based image pipeline + ink saver
│   ├── pdf/       PDF export engine + grid renderer
│   ├── print/     Direct printing via Electron webContents
│   ├── calibration/  Per-printer calibration store
│   └── project/   Project file (.tilr) save/load
├── preload/       contextBridge API surface
├── renderer/      React 18 UI
│   ├── components/  Toolbar, PreviewCanvas, SettingsPanel, etc.
│   ├── hooks/     usePreviewRenderer, useCalibration
│   ├── store/     Zustand + Immer state management
│   └── ipc/       Type-safe bridge wrappers
└── shared/        Types and pure functions shared across processes
    ├── TilingCalculator.ts   Core tiling algorithm
    ├── calibration.ts        Two-point DPI calibration
    ├── constants.ts          Paper sizes, supported formats
    └── ipc-types.ts          All IPC channel types
```

## Features

- Open images (JPEG, PNG, TIFF, BMP, GIF, WebP, SVG) and PDF files
- Auto-detect DPI from embedded metadata
- Two-point on-canvas calibration for accurate scale
- Tile across any paper size (Letter, Legal, Tabloid, A3, A4, A5)
- Configurable overlap on all four edges
- Diagonal or grid alignment lines for easy assembly
- Cut marks and page labels (grid A1/B2 or sequential 1/12)
- Ink saver: brightness, gamma, edge-aware fade
- Export to multi-page PDF
- Direct print to any system printer
- Save/Load `.tilr` project files
- Dark mode support
- Drag-and-drop and clipboard paste

## Project Files

Projects are saved as `.tilr` files — JSON containing all settings except the source image path. Re-open the source image separately after loading a project.
