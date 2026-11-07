# Tubus

Tubus is a single-page site that presents a library of accordion-fold leporello booklets. The home page shows the closed books side by side; click one and it comes forward, with the interface appearing around it. *Tubus* in the header (or Esc) goes back.

Books so far: *Deliberation* (A04 · Folding Ideas) and a placeholder *Book Two*.

Each book has three modes: **Folded** (a closed stack), **Unfolded** (the accordion opens in a zigzag into a horizontal strip) and **Page by page** (one page at a time; the next panel folds over). Vite + vanilla JS. The only runtime dependency is PDF.js, which loads only when vector mode is switched on.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build → dist/
npm run preview    # serve dist/ locally
```

Requires Node 20.6+. The site itself has no books in it: at startup it reads `library.json` and the page images from a public **Cloudflare R2** bucket (`tubus`). `VITE_LIBRARY_URL` overrides the bucket address (the default is set in `src/images.js`).

## Add a book to the library

1. Add an entry to `books.json` (order = order on the shelf):
   ```json
   { "id": "my-book", "title": "My Book", "author": "Dmitrii Demidov", "meta": "A08 · Title of the project", "pdf": "MyBook.pdf" }
   ```
   `pdf` is optional (`null` or leave the file out to turn off *Download PDF* and vector mode for that book).
2. Put the Figma exports in `pages/<id>/` as `01.png`, `02.png`, … (any count, in reading order). A5 portrait exports (1680×2380) are expected. Larger files work too: the original size is added to the srcset automatically. The first page is the cover shown in the library.
3. Put the PDF in the same folder (`pages/<id>/MyBook.pdf`).
4. Add `pages/<id>/pages.json`: one entry per page, matched by `index` (1-based):
   ```json
   { "index": 5, "title": "Integrity", "section": "Vocabulary", "alt": "optional longer alt text" }
   ```
   `title` is used as the alt text, thumbnail label and zoom label (`alt` overrides the alt text). `section` labels the counter and groups the thumbnails.
5. Publish: `npm run library:publish`. It encodes the pages (cached by content hash, so only new or changed pages take time, about 5 s per page), uploads them to R2 and refreshes `library.json`. The site shows the change on the next reload, no deploy needed. One-time setup: copy `.env.example` to `.env` and put the R2 access key in it (never commit `.env`). `node scripts/publish.mjs --dry` encodes and builds `library.json` without uploading.

> *Book Two* currently uses **generated placeholder pages**. Drop the real `01.png …` into `pages/book-two/` over them (or `npm run placeholders -- <id> "<Title>" <count>` makes new placeholders for another book), and edit its entry in `books.json`.

### What the image build does

For each page of each book it writes to `.cache/images/img/` (and `publish` uploads them to the bucket under `img/`):

- AVIF, WebP and PNG at **420, 840 and 1680 px** wide. Nothing is ever upscaled: widths above the source are skipped.
- An untouched copy of the original for the zoom view.
- File names with a content hash, served with `Cache-Control: immutable`.

The page uses `<picture>` with `srcset` + `sizes` set to the exact drawn width, so the browser picks the right file for the screen and devicePixelRatio. Page-by-page mode loads the current page at high priority and preloads ±2 pages. The strip and thumbnails lazy-load with IntersectionObserver.

**Zoom**: click or tap a page. Wheel / pinch / double-click to zoom, drag to pan, ← → to change page, Esc to close. Zoom stops at 1 image pixel per screen pixel, so the image is never upscaled.

**Vector pages (PDF)**: Settings → *Vector pages*. The focused page and the zoom view are rendered with PDF.js at the device pixel ratio, so text stays vector-sharp at any zoom. It's off by default. Compare it with the PNGs and keep it only if it looks better.

## Deploy

The output is fully static (`dist/`), and since the books live in R2, a deploy takes seconds.

- **Vercel**: import the repo. `vercel.json` sets the build command and output directory.
- **Netlify**: import the repo. `netlify.toml` sets `npm run build` → `dist`.
- Anything else: `npm run build` and upload `dist/`.

Adding or changing a book needs `npm run library:publish`, not a deploy. The bucket needs a CORS policy that allows `GET` (the site fetches `library.json` and PDFs from another origin).

## Customise

- Accent colours: `--blue` / `--pink` at the top of `src/styles.css`. Set them to the exact values from the cover.
- Fold feel: `CLOSED`, `ZIGZAG` and `PAPER` in `src/leporello.js`, `NEIGHBOUR` in `src/pageview.js`, the light direction in `src/panel.js`.

## Structure

```
books.json             the library: one entry per book (you edit this)
pages/<id>/            a book's source PNGs + PDF + pages.json (titles / sections / alt)
scripts/build-images.mjs     encodes pages into .cache/images
scripts/publish.mjs          encodes, uploads to R2, writes library.json
src/
  main.js              library, routing, header / settings
  book.js              one book: leporello, page-by-page view + thumbnails, zoom, keyboard
  leporello.js         folded ↔ unfolded 3D scene
  pageview.js          page-by-page fold view
  panel.js             paper panel, fold shading, chain geometry, tweening
  zoom.js              full-res zoom with pan / pinch
  pdf.js               optional PDF.js rendering
  images.js            <picture>/srcset helpers
```

Animations use only `transform` and `opacity`. With `prefers-reduced-motion`, every fold becomes a short fade. Deep links work too: `#<id>/folded`, `#<id>/unfolded`, `#<id>/page-5`; no hash is the library. Old links (`#unfolded`, `#page-5`) open the first book.
