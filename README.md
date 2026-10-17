# Deliberation — leporello

A single-page site that presents the booklet *Deliberation* (Dmitrii Demidov, Domus Academy, 2026) as an accordion-fold leporello.

Three modes: **Folded** (a closed stack), **Unfolded** (the accordion opens in a zigzag into a horizontal strip) and **Page by page** (one page at a time; the next panel folds over). Vite + vanilla JS. The only runtime dependency is PDF.js, which loads only when vector mode is switched on.

## Run locally

```bash
npm install
npm run dev        # builds images (first run ≈1 min), then starts http://localhost:5173
npm run build      # production build → dist/
npm run preview    # serve dist/ locally
```

Requires Node 18+.

## Replace / add pages

1. Put the Figma exports in `/pages` as `01.png`, `02.png`, … (any count, in reading order). 4x A5 exports (1680×2380) are expected. Larger files work too: the original size is added to the srcset automatically.
2. Put the PDF in `/pages/DmitriiDemidovA05.pdf`. This turns on the **Download PDF** button and the optional vector mode.
3. Edit `pages.json`: one entry per page, matched by `index` (1-based):
   ```json
   { "index": 5, "title": "Integrity", "section": "Vocabulary", "alt": "optional longer alt text" }
   ```
   `title` is used as the alt text, thumbnail label and zoom label (`alt` overrides the alt text). `section` is one of `Vocabulary`, `Artifacts`, `Makers`. It labels the counter and groups the thumbnails.
4. If `npm run dev` is already running, it notices changes in `/pages`, re-encodes only the changed files and reloads the browser. It takes about 4 s per new page, and progress shows in the terminal. Otherwise run `npm run dev` or `npm run build`.

> The repo currently has **generated placeholder pages** (`npm run placeholders` creates them only if `/pages` is empty). Dropping in your real `01.png … 22.png` overwrites them.

### What the image build does

For each page it writes to `public/generated/`:

- AVIF, WebP and PNG at **420, 840 and 1680 px** wide. Nothing is ever upscaled: widths above the source are skipped.
- An untouched copy of the original for the zoom view.
- File names with a content hash, served with `Cache-Control: immutable`.

The page uses `<picture>` with `srcset` + `sizes` set to the exact drawn width, so the browser picks the right file for the screen and devicePixelRatio. Page-by-page mode loads the current page at high priority and preloads ±2 pages. The strip and thumbnails lazy-load with IntersectionObserver.

**Zoom**: click or tap a page. Wheel / pinch / double-click to zoom, drag to pan, ← → to change page, Esc to close. Zoom stops at 1 image pixel per screen pixel, so the image is never upscaled.

**Vector pages (PDF)**: Settings → *Vector pages*. The focused page and the zoom view are rendered with PDF.js at the device pixel ratio, so text stays vector-sharp at any zoom. It's off by default. Compare it with the PNGs and keep it only if it looks better.

## Deploy

The output is fully static (`dist/`).

- **Vercel**: import the repo. `vercel.json` sets the build command and output directory.
- **Netlify**: import the repo. `netlify.toml` sets `npm run build` → `dist`.
- Anything else: `npm run build` and upload `dist/`.

`public/generated/` and `src/generated/` are not committed: every deploy rebuilds them from `/pages` (about 1–2 min for 28 pages).

## Customise

- Accent colours: `--blue` / `--pink` at the top of `src/styles.css`. Set them to the exact values from the cover.
- Fold feel: `CLOSED`, `ZIGZAG` and `PAPER` in `src/leporello.js`, `NEIGHBOUR` in `src/pageview.js`, the light direction in `src/panel.js`.

## Structure

```
pages/                 source PNGs + PDF (you edit these)
pages.json             titles / sections / alt (you edit this)
scripts/build-images.mjs
src/
  main.js              modes, settings, keyboard, thumbnails, URL hash
  leporello.js         folded ↔ unfolded 3D scene
  pageview.js          page-by-page fold view
  panel.js             paper panel, fold shading, chain geometry, tweening
  zoom.js              full-res zoom with pan / pinch
  pdf.js               optional PDF.js rendering
  images.js            <picture>/srcset helpers
```

Animations use only `transform` and `opacity`. With `prefers-reduced-motion`, every fold becomes a short fade. Deep links work too: `#folded`, `#unfolded`, `#page-5`.
