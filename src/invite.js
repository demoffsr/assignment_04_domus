// The invite link and its QR code. The link carries the shared invite code, so opening it
// fills the code in and the newcomer only has to pick a name.
import qrcode from 'qrcode-generator';

export const inviteLink = (code) => `${location.origin}${location.pathname}?invite=${encodeURIComponent(code)}`;

const INK = '#0e0e0e';
const MARGIN = 3.5; // quiet zone, in modules
const BADGE = 7; // the centre badge, in modules (the error correction absorbs it)

/**
 * Draws `text` as a QR code: rounded modules, soft finder squares and a "T" badge in the
 * middle. Dark on white, so every phone camera reads it.
 */
export function renderQr(el, text) {
  const qr = qrcode(0, 'Q');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const mid = n / 2;
  const inFinder = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
  const inBadge = (r, c) => Math.abs(r + 0.5 - mid) < BADGE / 2 + 0.6 && Math.abs(c + 0.5 - mid) < BADGE / 2 + 0.6;

  let dots = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c) && !inFinder(r, c) && !inBadge(r, c)) dots += `<rect x="${c + 0.06}" y="${r + 0.06}" width="0.88" height="0.88" rx="0.34"/>`;
    }
  }
  const finder = (x, y) =>
    `<rect x="${x}" y="${y}" width="7" height="7" rx="2.2"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="1.5" fill="#fff"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1.05"/>`;
  const b = mid - BADGE / 2;

  el.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-MARGIN} ${-MARGIN} ${n + MARGIN * 2} ${n + MARGIN * 2}" role="img" aria-label="QR code with the invite link" fill="${INK}">` +
    dots + finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7) +
    `<rect x="${b}" y="${b}" width="${BADGE}" height="${BADGE}" rx="2.2"/>` +
    `<text x="${mid}" y="${mid + 0.18}" fill="#fff" font-family="Inter, system-ui, sans-serif" font-size="4.6" font-weight="600" text-anchor="middle" dominant-baseline="central">T</text>` +
    `</svg>`;
}
