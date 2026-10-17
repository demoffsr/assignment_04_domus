// Build-time image pipeline.
// Reads /pages/NN.png, writes resized AVIF / WebP / PNG variants into
// public/generated/ and a manifest that the app imports.
// - Never upscales: widths larger than the source are dropped.
// - The untouched original is copied for the zoom view.
// - File names carry a content hash, so they can be cached forever.
// - Unchanged sources are skipped on rebuild.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const srcDir = join(root, 'pages');
const outDir = join(root, 'public', 'generated');
const manifestPath = join(root, 'src', 'generated', 'manifest.json');
const WIDTHS = [420, 840, 1680];
const PDF_NAME = 'DmitriiDemidovA05.pdf';

mkdirSync(outDir, { recursive: true });
mkdirSync(join(root, 'src', 'generated'), { recursive: true });

const files = readdirSync(srcDir).filter((f) => /^\d+\.png$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
if (!files.length) {
  console.error('[images] No pages found in /pages (expected 01.png, 02.png, …)');
  process.exit(1);
}

const wanted = new Set();
const pages = [];
let built = 0;

for (const file of files) {
  const buf = readFileSync(join(srcDir, file));
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 8);
  const base = file.replace(/\.png$/i, '');
  const img = sharp(buf);
  const { width, height } = await img.metadata();
  const widths = [...new Set([...WIDTHS.filter((w) => w < width), width])];

  const original = `${base}-original-${hash}.png`;
  wanted.add(original);
  if (!existsSync(join(outDir, original))) copyFileSync(join(srcDir, file), join(outDir, original));

  const variants = { avif: [], webp: [], png: [] };
  for (const w of widths) {
    for (const fmt of Object.keys(variants)) {
      if (fmt === 'png' && w === width) {
        variants.png.push({ w, src: `/generated/${original}` }); // the original is the full-size PNG
        continue;
      }
      const name = `${base}-${w}-${hash}.${fmt}`;
      wanted.add(name);
      variants[fmt].push({ w, src: `/generated/${name}` });
      const out = join(outDir, name);
      if (existsSync(out)) continue;
      let p = sharp(buf);
      if (w !== width) p = p.resize({ width: w, kernel: 'lanczos3' });
      if (fmt === 'avif') p = p.avif({ quality: 62, effort: 5, chromaSubsampling: '4:4:4' });
      if (fmt === 'webp') p = p.webp({ quality: 88, smartSubsample: true, effort: 5 });
      if (fmt === 'png') p = p.png({ compressionLevel: 9, palette: false });
      await p.toFile(out);
      built++;
    }
  }

  // Average colour of the page border = the paper colour. Used behind the image
  // (so anti-aliased edges never show a light fringe) and for the back of the sheet.
  pages.push({ file, width, height, hash, variants, original: `/generated/${original}`, paper: await edgeColour(buf) });
  process.stdout.write(`\r[images] ${pages.length}/${files.length}`);
}

// Remove stale variants from earlier builds.
for (const f of readdirSync(outDir)) {
  if (!wanted.has(f) && f !== PDF_NAME) rmSync(join(outDir, f));
}

async function edgeColour(buf) {
  const S = 48;
  const { data, info } = await sharp(buf).removeAlpha().resize(S, S, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (x > 1 && x < S - 2 && y > 1 && y < S - 2) continue; // 2px border only
      const i = (y * S + x) * info.channels;
      sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2];
      n++;
    }
  }
  const [r, g, b] = sum.map((v) => Math.round(v / n));
  return { r, g, b };
}

let pdf = null;
if (existsSync(join(srcDir, PDF_NAME))) {
  copyFileSync(join(srcDir, PDF_NAME), join(outDir, PDF_NAME));
  pdf = `/generated/${PDF_NAME}`;
} else {
  console.warn(`\n[images] ${PDF_NAME} not found in /pages — Download button and PDF rendering disabled.`);
}

writeFileSync(manifestPath, JSON.stringify({ pdf, pages }, null, 2));
console.log(`\n[images] ${pages.length} pages, ${built} new files written.`);
