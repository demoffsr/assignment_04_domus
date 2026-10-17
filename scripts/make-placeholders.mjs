// Generates 22 placeholder pages (1680×2380) so the site can run before the
// real Figma exports are dropped into /pages. Never overwrites existing files.
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../pages/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const W = 1680, H = 2380, N = 22;

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
    ${cover ? `<circle cx="1180" cy="760" r="360" fill="#1f3bff"/><circle cx="560" cy="1120" r="260" fill="#ff3d9a"/>` : `<rect x="140" y="320" width="1400" height="1000" rx="40" fill="#e3e3df"/>`}
    <text x="140" y="240" font-family="Helvetica, Arial" font-weight="700" font-size="96" fill="${fg}">${cover ? 'Deliberation' : 'Page ' + i}</text>
    <g font-family="Helvetica, Arial">${lines}</g>
    <text x="140" y="2240" font-family="Helvetica, Arial" font-size="34" fill="${fg}" opacity=".5">PLACEHOLDER ${String(i).padStart(2, '0')} / ${N}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log('placeholder', name);
}
