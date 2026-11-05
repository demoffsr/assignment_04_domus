// Generates placeholder pages (1680×2380) for a book so the site can run before
// the real Figma exports are dropped into /pages/<id>. Never overwrites existing files.
//   node scripts/make-placeholders.mjs <id> "<Title>" [count]
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [id = 'book-two', title = 'Book Two', count = '6'] = process.argv.slice(2);
const dir = join(new URL('../pages/', import.meta.url).pathname, id);
mkdirSync(dir, { recursive: true });
const W = 1680, H = 2380, N = +count;

// Cover accents differ per id so placeholder books are easy to tell apart.
const ACCENTS = [['#1f3bff', '#ff3d9a'], ['#ff7a1a', '#18c29c'], ['#8a3dff', '#ffd23d']];
const [a1, a2] = ACCENTS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % ACCENTS.length];

for (let i = 1; i <= N; i++) {
  const name = String(i).padStart(2, '0') + '.png';
  const out = join(dir, name);
  if (existsSync(out)) continue;
  const cover = i === 1;
  const bg = cover ? '#0a0a0a' : '#f4f4f1';
  const fg = cover ? '#ffffff' : '#111111';
  const lines = Array.from({ length: 14 }, (_, k) =>
    `<text x="140" y="${1500 + k * 46}" font-size="30" fill="${fg}" opacity=".7">Placeholder body copy, line ${k + 1} — fine text to judge image sharpness.</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="${bg}"/>
    ${cover ? `<circle cx="1180" cy="760" r="360" fill="${a1}"/><circle cx="560" cy="1120" r="260" fill="${a2}"/>` : `<rect x="140" y="320" width="1400" height="1000" rx="40" fill="#e3e3df"/>`}
    <text x="140" y="240" font-family="Helvetica, Arial" font-weight="700" font-size="96" fill="${fg}">${cover ? title : 'Page ' + i}</text>
    <g font-family="Helvetica, Arial">${lines}</g>
    <text x="140" y="2240" font-family="Helvetica, Arial" font-size="34" fill="${fg}" opacity=".5">PLACEHOLDER ${String(i).padStart(2, '0')} / ${N}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log('placeholder', id, name);
}
