import manifest from './generated/manifest.json';
import library from '../books.json';

export const ASPECT = 148 / 210; // A5 portrait, width / height

// Editable titles live next to each book's pages: /pages/<id>/pages.json.
const titles = import.meta.glob('../pages/*/pages.json', { eager: true, import: 'default' });

/**
 * Books from books.json that the image build produced pages for. Each page
 * merges the build manifest with its entry in pages.json (matched by index).
 */
export const books = library
  .filter((b) => manifest.books[b.id])
  .map((b) => {
    const built = manifest.books[b.id];
    const meta = titles[`../pages/${b.id}/pages.json`] || [];
    const pages = built.pages.map((img, i) => {
      const m = meta.find((t) => t.index === i + 1) || {};
      const title = m.title || `Page ${i + 1}`;
      return { ...img, index: i, title, section: m.section || '', alt: m.alt || title };
    });
    return { ...b, pdfUrl: built.pdf, pages };
  });

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
