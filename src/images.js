import { API_URL } from './auth.js';

export const ASPECT = 148 / 210; // A5 portrait, width / height

// Where scripts/publish.mjs puts library.json and the images (a public R2 bucket).
const BASE = (import.meta.env.VITE_LIBRARY_URL || 'https://pub-b854f392891e4020bbf5dcf7c6e9ffd4.r2.dev').replace(/\/$/, '');
const url = (key) => `${BASE}/${key}`;

// The API is the source of truth; library.json in R2 is only a safety net.
let library = null;
for (const source of [`${API_URL}/library`, url('library.json')]) {
  try {
    const res = await fetch(source, { cache: 'no-cache' }); // revalidates with the ETag
    if (!res.ok) throw new Error(`${source}: ${res.status}`);
    library = await res.json();
    break;
  } catch (err) {
    console.warn('[tubus] could not load the library from', source, err);
  }
}
/** True when no source answered (an empty library is not an error). */
export const libraryError = !library;
library ||= { books: [] };

/** The books, with every storage key turned into a full URL. */
export const books = library.books.map((b) => ({
  ...b,
  pdfUrl: b.pdf ? url(b.pdf) : null,
  pages: b.pages.map((p, i) => ({
    ...p,
    index: i,
    original: url(p.original),
    variants: Object.fromEntries(Object.entries(p.variants).map(([fmt, list]) => [fmt, list.map((v) => ({ ...v, src: url(v.src) }))])),
  })),
}));

const srcset = (list) => list.map((v) => `${v.src} ${v.w}w`).join(', ');

/**
 * <picture> with AVIF → WebP → PNG sources. srcset is held back in data-*
 * until hydrate() is called, so pages load lazily and on our schedule.
 */
export function createPicture(page, { sizes = '100vw', eager = false } = {}) {
  const pic = document.createElement('picture');
  for (const fmt of ['avif', 'webp']) {
    const s = document.createElement('source');
    s.type = `image/${fmt}`;
    s.dataset.srcset = srcset(page.variants[fmt]);
    s.sizes = sizes;
    pic.append(s);
  }
  const img = document.createElement('img');
  img.alt = page.alt;
  img.width = page.width;
  img.height = page.height;
  img.decoding = 'async';
  img.draggable = false;
  img.dataset.srcset = srcset(page.variants.png);
  img.dataset.src = page.variants.png[0].src;
  img.sizes = sizes;
  img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  pic.append(img);
  if (eager) hydrate(pic);
  return pic;
}

export function hydrate(pic, priority) {
  if (!pic || pic.dataset.hydrated) return;
  pic.dataset.hydrated = '1';
  const img = pic.querySelector('img');
  if (priority) img.fetchPriority = priority;
  pic.querySelectorAll('source').forEach((s) => (s.srcset = s.dataset.srcset));
  img.srcset = img.dataset.srcset;
  img.src = img.dataset.src;
}

/** Tell the browser how wide the picture is drawn; it then picks by DPR. */
export function setSizes(pic, cssWidth) {
  const v = `${Math.ceil(cssWidth)}px`;
  pic.querySelectorAll('source, img').forEach((el) => {
    if (el.sizes !== v) el.sizes = v;
  });
}
