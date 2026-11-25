// Clickable links that live inside a PDF page. They are read from the PDF when a book is uploaded,
// stored with each page as { x, y, w, h, url } (fractions 0–1 of the page, from the top-left),
// and drawn over the page as invisible <a> zones.

const OK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** The address if it is a web or mail link, otherwise null (never `javascript:` and the like). */
export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    return OK_PROTOCOLS.has(new URL(value).protocol) ? value : null;
  } catch {
    return null;
  }
}

const round = (n) => Math.round(n * 1e4) / 1e4;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Links of a whole PDF sheet → links of one A5 page cut from it.
 *
 * `sheetLinks` are fractions of the sheet; the page is the `part`-th of `n` equal slices side by side
 * (n = 1 for a sheet that is not cut). This repeats what the upload does when it draws the page
 * (`compose`): a sheet that is nearly A5 is stretched to fill, any other shape is fitted and centred.
 * Links outside the slice are dropped; links across a cut are clipped to each side.
 */
export function cropLinks(sheetLinks, part, n, sheetW, sheetH, aspect) {
  if (!sheetLinks?.length) return [];
  const sw = sheetW / n; // the slice, in PDF points
  const sh = sheetH;
  const pw = 1; // the page, in its own units: 1 wide, 1 / aspect tall
  const ph = 1 / aspect;
  let kx, ky, ox, oy;
  if (Math.abs(sw / sh / aspect - 1) < 0.03) {
    [kx, ky, ox, oy] = [pw / sw, ph / sh, 0, 0];
  } else {
    kx = ky = Math.min(pw / sw, ph / sh);
    ox = (pw - sw * kx) / 2;
    oy = (ph - sh * ky) / 2;
  }
  const out = [];
  for (const l of sheetLinks) {
    const x0 = clamp(l.x * sheetW - part * sw, 0, sw);
    const x1 = clamp((l.x + l.w) * sheetW - part * sw, 0, sw);
    const y0 = clamp(l.y * sheetH, 0, sh);
    const y1 = clamp((l.y + l.h) * sheetH, 0, sh);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue; // outside this page, or a sliver of it
    out.push({
      x: round((ox + x0 * kx) / pw),
      y: round((oy + y0 * ky) / ph),
      w: round(((x1 - x0) * kx) / pw),
      h: round(((y1 - y0) * ky) / ph),
      url: l.url,
    });
  }
  return out;
}

const pct = (n) => `${(n * 100).toFixed(3)}%`;

/** A layer of invisible links over a page, or null when the page has none. */
export function createLinkLayer(links, className) {
  const items = (links || []).filter((l) => safeUrl(l.url));
  if (!items.length) return null;
  const layer = document.createElement('div');
  layer.className = className;
  for (const l of items) {
    const a = document.createElement('a');
    a.className = 'plink';
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = l.url;
    a.style.cssText = `left:${pct(l.x)};top:${pct(l.y)};width:${pct(l.w)};height:${pct(l.h)}`;
    a.draggable = false;
    layer.append(a);
  }
  return layer;
}
