// Tubus API: accounts (invite code + username), the public library, uploads.
// See docs/superpowers/specs/2026-11-07-accounts-and-uploads-design.md

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

/** Compares two secrets without leaking where they differ. */
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const MAX_UPLOAD = 25 * 1024 * 1024; // one page image or a PDF
const TYPES = { webp: 'image/webp', png: 'image/png', avif: 'image/avif', pdf: 'application/pdf' };

function cors(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const reply = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

// --- accounts ---------------------------------------------------------------
const USERNAME = /^[a-z0-9._-]{3,24}$/;
const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'author';

async function checkInvite(env, invite) {
  if (!env.INVITE_CODE) throw new HttpError(500, 'invite_not_configured');
  if (!(await safeEqual(invite ?? '', env.INVITE_CODE))) throw new HttpError(403, 'bad_invite');
}

async function startSession(env, userId) {
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id) VALUES (?, ?)').bind(await sha256(token), userId).run();
  return token;
}

// What the signed-in person gets about themselves. The username is private, so it is
// only ever sent back to its owner (never in /api/library).
const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, slug: u.slug });

async function currentUser(request, env) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') || '');
  if (!m) return null;
  const hash = await sha256(m[1]);
  const user = await env.DB.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
  ).bind(hash).first();
  if (user) env.DB.prepare("UPDATE sessions SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash = ?").bind(hash).run();
  return user;
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'not_signed_in');
  return user;
}

const isAdmin = (env, user) => (env.ADMIN_USERNAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(user.username);

async function register(request, env) {
  const { invite, username, displayName } = await body(request);
  await checkInvite(env, invite);
  const uname = cleanName(username).toLowerCase();
  const name = cleanName(displayName);
  if (!USERNAME.test(uname)) throw new HttpError(400, 'bad_username'); // 3–24 of a-z 0-9 . _ -
  if (name.length < 2 || name.length > 40) throw new HttpError(400, 'bad_display_name');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(uname).first()) throw new HttpError(409, 'username_taken');

  const slug = await uniqueSlug(env, slugify(name));
  const id = randomHex(8);
  await env.DB.prepare('INSERT INTO users (id, username, display_name, slug) VALUES (?, ?, ?, ?)').bind(id, uname, name, slug).run();
  await audit(env, id, 'register');
  return reply({ token: await startSession(env, id), user: publicUser({ id, username: uname, display_name: name, slug }) }, 201);
}

/** `base`, or `base-2`, `base-3`… if another person already has it. */
async function uniqueSlug(env, base, selfId = '') {
  let slug = base;
  for (let n = 2; await env.DB.prepare('SELECT 1 FROM users WHERE slug = ? AND id != ?').bind(slug, selfId).first(); n++) slug = `${base}-${n}`;
  return slug;
}

/** Lets a person fix their username or name. Their sessions stay valid. */
async function updateMe(request, env) {
  const user = await requireUser(request, env);
  const { username, displayName } = await body(request);
  let uname = user.username;
  let name = user.display_name;
  let slug = user.slug;

  if (username !== undefined) {
    uname = cleanName(username).toLowerCase();
    if (!USERNAME.test(uname)) throw new HttpError(400, 'bad_username');
    if (uname !== user.username && (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(uname).first())) throw new HttpError(409, 'username_taken');
  }
  if (displayName !== undefined) {
    name = cleanName(displayName);
    if (name.length < 2 || name.length > 40) throw new HttpError(400, 'bad_display_name');
    if (name !== user.display_name) slug = await uniqueSlug(env, slugify(name), user.id);
  }

  try {
    await env.DB.prepare('UPDATE users SET username = ?, display_name = ?, slug = ? WHERE id = ?').bind(uname, name, slug, user.id).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'username_taken'); // lost a race
    throw err;
  }
  await audit(env, user.id, 'profile');
  return reply({ user: publicUser({ id: user.id, username: uname, display_name: name, slug }) });
}

async function login(request, env) {
  const { invite, username } = await body(request);
  await checkInvite(env, invite);
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(cleanName(username).toLowerCase()).first();
  if (!user) throw new HttpError(404, 'no_such_user');
  await audit(env, user.id, 'login');
  return reply({ token: await startSession(env, user.id), user: publicUser(user) });
}

async function logout(request, env) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') || '');
  if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).run();
  return reply({ ok: true });
}

const audit = (env, userId, action, bookId = null) =>
  env.DB.prepare('INSERT INTO audit (user_id, action, book_id) VALUES (?, ?, ?)').bind(userId, action, bookId).run();

// --- library ----------------------------------------------------------------
async function library(env) {
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.title, b.meta, b.pdf_key, b.manifest, b.credit, u.display_name, u.slug
       FROM books b JOIN users u ON u.id = b.owner_id
      WHERE b.published_at IS NOT NULL AND b.deleted_at IS NULL
      ORDER BY b.published_at, b.created_at`,
  ).all();
  const books = results.map((b) => ({
    id: b.id,
    title: b.title,
    meta: b.meta,
    author: b.credit || b.display_name,
    authorSlug: b.slug,
    pdf: b.pdf_key,
    pages: JSON.parse(b.manifest).pages,
  }));
  return reply({ books }, 200, { 'cache-control': 'public, max-age=15' });
}

/** Everyone in the library, with how many books each has published. Members only. */
async function people(request, env) {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.slug, COUNT(b.id) AS books
       FROM users u
       LEFT JOIN books b ON b.owner_id = u.id AND b.published_at IS NOT NULL AND b.deleted_at IS NULL
      GROUP BY u.id
      ORDER BY u.created_at, u.id`,
  ).all();
  return reply({ people: results.map((r) => ({ name: r.display_name, slug: r.slug, books: r.books, me: r.id === user.id })) });
}

// --- books ------------------------------------------------------------------
async function ownBook(env, user, id, { allowAdmin = false } = {}) {
  const book = await env.DB.prepare('SELECT * FROM books WHERE id = ? AND deleted_at IS NULL').bind(id).first();
  if (!book || (book.owner_id !== user.id && !(allowAdmin && isAdmin(env, user)))) throw new HttpError(404, 'no_such_book');
  return book;
}

async function createDraft(request, env) {
  const user = await requireUser(request, env);
  const id = randomHex(8);
  await env.DB.prepare('INSERT INTO books (id, owner_id) VALUES (?, ?)').bind(id, user.id).run();
  return reply({ id }, 201);
}

async function upload(request, env, bookId, name) {
  const user = await requireUser(request, env);
  await ownBook(env, user, bookId);
  const ext = /^[a-z0-9][a-z0-9._-]{0,80}\.(webp|png|avif|pdf)$/.exec(name)?.[1];
  if (!ext) throw new HttpError(400, 'bad_file_name');
  if (+(request.headers.get('content-length') || 0) > MAX_UPLOAD) throw new HttpError(413, 'too_large');
  if (!request.body) throw new HttpError(400, 'empty_body');
  await env.BUCKET.put(`u/${bookId}/${name}`, request.body, {
    httpMetadata: { contentType: TYPES[ext], cacheControl: ext === 'pdf' ? 'public, max-age=3600' : 'public, max-age=31536000, immutable' },
  });
  return reply({ key: `u/${bookId}/${name}` }, 201);
}

const str = (v, max) => String(v ?? '').slice(0, max);
const int = (v) => (Number.isInteger(v) && v > 0 && v < 20000 ? v : null);

/** Keeps only what the site renders, and only keys inside this book's folder. */
function cleanPages(pages, prefix) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 200) throw new HttpError(400, 'bad_pages');
  const key = (k) => {
    if (typeof k !== 'string' || !k.startsWith(prefix) || k.includes('..')) throw new HttpError(400, 'bad_key');
    return k;
  };
  const list = (l) => (Array.isArray(l) ? l.map((v) => ({ w: int(v?.w) ?? (() => { throw new HttpError(400, 'bad_variant'); })(), src: key(v?.src) })) : []);
  return pages.map((p) => {
    const variants = { avif: list(p?.variants?.avif), webp: list(p?.variants?.webp), png: list(p?.variants?.png) };
    if (!variants.png.length) throw new HttpError(400, 'bad_variant'); // the <img> fallback
    const { r, g, b } = p?.paper || {};
    const title = str(p?.title, 80);
    return {
      width: int(p?.width) ?? (() => { throw new HttpError(400, 'bad_size'); })(),
      height: int(p?.height) ?? (() => { throw new HttpError(400, 'bad_size'); })(),
      variants,
      original: key(p?.original),
      paper: { r: r | 0, g: g | 0, b: b | 0 },
      title,
      section: str(p?.section, 40),
      alt: str(p?.alt, 160) || title,
    };
  });
}

async function publish(request, env, id) {
  const user = await requireUser(request, env);
  await ownBook(env, user, id);
  const { title, meta, pdf, pages } = await body(request);
  const t = cleanName(title);
  if (t.length < 1 || t.length > 80) throw new HttpError(400, 'bad_title');
  const prefix = `u/${id}/`;
  const manifest = JSON.stringify({ pages: cleanPages(pages, prefix) });
  const pdfKey = pdf ? (pdf.startsWith(prefix) && !pdf.includes('..') ? pdf : (() => { throw new HttpError(400, 'bad_key'); })()) : null;
  await env.DB.prepare(
    "UPDATE books SET title = ?, meta = ?, pdf_key = ?, manifest = ?, published_at = COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?",
  ).bind(t, cleanName(meta).slice(0, 80), pdfKey, manifest, id).run();
  await audit(env, user.id, 'publish', id);
  return reply({ id });
}

async function remove(request, env, id) {
  const user = await requireUser(request, env);
  await ownBook(env, user, id, { allowAdmin: true });
  await env.DB.prepare("UPDATE books SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(id).run();
  await audit(env, user.id, 'delete', id);
  return reply({ ok: true });
}

// --- router -----------------------------------------------------------------
async function route(request, env) {
  const { pathname } = new URL(request.url);
  const m = (re) => re.exec(pathname);
  const get = request.method === 'GET';
  const post = request.method === 'POST';
  let r;

  if (get && pathname === '/api/health') return reply({ ok: true });
  if (get && pathname === '/api/library') return library(env);
  if (get && pathname === '/api/people') return people(request, env);
  if (post && pathname === '/api/register') return register(request, env);
  if (post && pathname === '/api/login') return login(request, env);
  if (post && pathname === '/api/logout') return logout(request, env);
  if (get && pathname === '/api/me') return reply({ user: publicUser(await requireUser(request, env)) });
  if (request.method === 'PATCH' && pathname === '/api/me') return updateMe(request, env);
  if (post && pathname === '/api/books') return createDraft(request, env);
  if (request.method === 'PUT' && (r = m(/^\/api\/upload\/([a-f0-9]{16})\/([^/]+)$/))) return upload(request, env, r[1], decodeURIComponent(r[2]));
  if (post && (r = m(/^\/api\/books\/([a-f0-9]{16})\/publish$/))) return publish(request, env, r[1]);
  if (request.method === 'DELETE' && (r = m(/^\/api\/books\/([a-f0-9]{16})$/))) return remove(request, env, r[1]);
  throw new HttpError(404, 'not_found');
}

export default {
  async fetch(request, env) {
    const headers = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      const res = await route(request, env);
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    } catch (err) {
      if (err instanceof HttpError) return reply({ error: err.code }, err.status, headers);
      console.error(err);
      return reply({ error: 'server_error' }, 500, headers);
    }
  },
};
