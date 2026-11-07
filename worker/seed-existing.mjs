// Writes SQL that puts the books from .cache/images/library.json (made by
// `node scripts/publish.mjs --dry`) into D1, owned by an existing account.
//   node worker/seed-existing.mjs <owner-username> "<owner display name>" > .cache/seed.sql
// Then: wrangler d1 execute tubus [--local|--remote] --file=.cache/seed.sql -c worker/wrangler.toml
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [owner, ownerName] = process.argv.slice(2);
if (!owner || !ownerName) {
  console.error('usage: node worker/seed-existing.mjs <owner-username> "<owner display name>"');
  process.exit(1);
}
const root = new URL('..', import.meta.url).pathname;
const library = JSON.parse(readFileSync(`${root}.cache/images/library.json`, 'utf8'));
const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

// Existing books keep a stable id derived from their slug, and their original publish order.
const published = { deliberation: '2026-10-18T00:00:00.000Z', 'book-two': '2026-11-05T00:00:00.000Z' };
const out = [];
for (const b of library.books) {
  const id = createHash('sha1').update(b.id).digest('hex').slice(0, 16);
  const credit = b.author && b.author !== ownerName ? b.author : null;
  out.push(
    `INSERT OR REPLACE INTO books (id, owner_id, title, meta, pdf_key, credit, manifest, created_at, published_at) ` +
      `VALUES (${q(id)}, (SELECT id FROM users WHERE username = ${q(owner)}), ${q(b.title)}, ${q(b.meta)}, ${q(b.pdf)}, ${q(credit)}, ` +
      `${q(JSON.stringify({ pages: b.pages }))}, ${q(published[b.id] || new Date().toISOString())}, ${q(published[b.id] || new Date().toISOString())});`,
  );
}
console.log(out.join('\n'));
