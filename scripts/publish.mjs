// Publishes the library to R2:
//   1. encodes every book's pages (scripts/build-images.mjs, cached by content hash)
//   2. uploads new images and PDFs
//   3. uploads library.json, which the site reads at startup
// Usage: npm run library:publish   (needs R2_* in .env, see .env.example)
//        node scripts/publish.mjs --dry   (encode and write .cache/images/library.json, upload nothing)
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const cacheDir = join(root, '.cache', 'images');

const dry = process.argv.includes('--dry');
const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (!dry && !(R2_ENDPOINT && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)) {
  console.error('[publish] Missing R2_* values. Copy .env.example to .env and fill them in.');
  process.exit(1);
}
const s3 = dry ? null : new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const encode = spawnSync(process.execPath, [join(root, 'scripts', 'build-images.mjs')], { stdio: 'inherit' });
if (encode.status !== 0) process.exit(encode.status ?? 1);

const TYPES = { '.avif': 'image/avif', '.webp': 'image/webp', '.png': 'image/png', '.pdf': 'application/pdf', '.json': 'application/json' };
const IMMUTABLE = 'public, max-age=31536000, immutable';

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}
const put = (key, body, cacheControl) =>
  s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: TYPES[key.slice(key.lastIndexOf('.')).toLowerCase()],
    CacheControl: cacheControl,
  }));

/** Runs `fn` over `items`, `n` at a time. */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// --- library.json: books.json + pages.json titles + the encoder's manifest ----
const books = JSON.parse(readFileSync(join(root, 'books.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(cacheDir, 'manifest.json'), 'utf8'));
const library = {
  updated: new Date().toISOString(),
  books: books.filter((b) => manifest.books[b.id]).map((b) => {
    const built = manifest.books[b.id];
    const titlesPath = join(root, 'pages', b.id, 'pages.json');
    const titles = existsSync(titlesPath) ? JSON.parse(readFileSync(titlesPath, 'utf8')) : [];
    return {
      id: b.id, title: b.title, author: b.author, meta: b.meta || '',
      pdf: built.pdf,
      pages: built.pages.map((img, i) => {
        const t = titles.find((x) => x.index === i + 1) || {};
        const title = t.title || `Page ${i + 1}`;
        const { width, height, variants, original, paper } = img;
        return { width, height, variants, original, paper, title, section: t.section || '', alt: t.alt || title };
      }),
    };
  }),
};

if (dry) {
  writeFileSync(join(cacheDir, 'library.json'), JSON.stringify(library));
  console.log(`[publish] dry run: wrote .cache/images/library.json (${library.books.length} books). Nothing uploaded.`);
  process.exit(0);
}

// --- upload -------------------------------------------------------------------
const images = readdirSync(join(cacheDir, 'img'));
let uploaded = 0;
let done = 0;
await pool(images, 8, async (f) => {
  const key = `img/${f}`;
  if (!(await exists(key))) {
    await put(key, readFileSync(join(cacheDir, 'img', f)), IMMUTABLE);
    uploaded++;
  }
  process.stdout.write(`\r[publish] images ${++done}/${images.length}`);
});
console.log(`\n[publish] ${uploaded} new images uploaded, ${images.length - uploaded} already there.`);

for (const b of library.books.filter((x) => x.pdf)) {
  const src = join(root, 'pages', b.id, b.pdf.split('/').pop());
  await put(b.pdf, readFileSync(src), 'public, max-age=3600');
  console.log(`[publish] pdf ${b.pdf}`);
}

await put('library.json', JSON.stringify(library), 'public, max-age=60');
console.log(`[publish] library.json: ${library.books.length} books, ${library.books.reduce((n, b) => n + b.pages.length, 0)} pages.`);
