import manifest from './generated/manifest.json';
import titles from '../pages.json';

export const ASPECT = 148 / 210; // A5 portrait, width / height

// Merge build manifest with the editable titles in pages.json (matched by index).
export const pages = manifest.pages.map((img, i) => {
  const meta = titles.find((t) => t.index === i + 1) || {};
  const title = meta.title || `Page ${i + 1}`;
  return { ...img, index: i, title, section: meta.section || '', alt: meta.alt || title };
});

export const pdfUrl = manifest.pdf;

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
