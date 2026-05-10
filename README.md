# CS2 2D demo viewer

Browser-based **Counter-Strike 2** replay viewer: parse `.dem` files (or load pre-exported JSON), draw player positions and combat cues on a **2D radar-style** canvas, with optional map PNG alignment.

## Requirements

- **Node.js** 18+ recommended  
- npm (ships with Node)

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

### Production build

```bash
npm run build
npm run preview
```

## Loading a demo

| Method | Notes |
|--------|--------|
| **Export & load** (`.dem` in the toolbar) | Parses in the browser with **`@laihoe/demoparser2` WASM** (works from static `preview` / hosting). With **`npm run dev`**, the same action tries WASM first and can fall back to a faster **native** export via `POST /api/export-dem`. |
| **Bundled demo** | Dropdown + **Load** reads JSON URLs (see `public/demos-index.json` if present). |
| **JSON file** | Opens an export produced by this project (`mapName`, `tickRate`, `tickStep`, `players`, `frames`, …). |

CLI export (native parser, Node):

```bash
npm run export-demo -- path/to/match.dem path/to/out.json
```

Default output path when omitted: `public/demo-data.json`. Optional env: **`TICK_STEP`** (keep every Nth tick in the timeline; default `1`).

## Map overview images

Place square radar/overlays under **`public/map/`** or **`public/maps/`** as:

- `{mapName}.png`, or  
- `{mapName}_radar.png`, or  
- `image.png`

Geometry for bundled maps lives in **`src/mapOverview.ts`**.

## Project layout

| Path | Role |
|------|------|
| `src/main.ts` | Canvas UI, playback, overlays |
| `src/demoTypes.ts` | JSON shape / TypeScript types |
| `src/demo-export/buildDemoData.ts` | Shared export logic (WASM path) |
| `src/workers/demo-wasm.worker.ts` | WASM parser worker |
| `scripts/demo-buffer-to-json.mjs` | Node export (`export-demo`, dev API worker) |
| `vite.config.ts` | Vite + optional `/api/export-dem` (dev only) |

## Tech stack

- [Vite](https://vitejs.dev/) + TypeScript  
- [@laihoe/demoparser2](https://www.npmjs.com/package/@laihoe/demoparser2) — native bindings for Node; **WASM** bundle under `node_modules/.../wasm/pkg/` for the browser worker  

## License

ISC (see `package.json`).
