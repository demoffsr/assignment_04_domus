# Tubus: accounts and self-service uploads

## Intent
Around 15–18 classmates (≈6 groups) publish their own leporellos to Tubus and get a personal library, without the owner doing anything per book. People must not be asked to hand over a Google account or invent a password.

## Decisions (made with the owner)
- **Login = invite code + username.** No password, no email, no third-party sign-in for now. Access code and email codes may come later (email needs an own domain).
- **Username is private**: it is never shown on the site. The public identity is the **display name** ("Dmitrii Demidov"), plus a **public slug** derived from it, used in personal-library URLs.
- **Invite code** is one shared secret. It is required to register and to sign in on a device that has no session. A signed-in browser keeps a session token.
- **Publishing is instant.** The owner can remove any book afterwards. Deletion is soft (a book is hidden, its files stay in R2).
- **Known, accepted risk:** someone who has the invite code and knows another person's username can sign in as them. Mitigations: soft delete, an audit log, and the option to add an access code later without redoing the data model.

## Non-goals
Passwords, email login, Google/Apple sign-in, per-book moderation queue, comments or likes.

## Architecture
- **Cloudflare Worker** (`worker/`) with bindings: `DB` (D1), `BUCKET` (R2 `tubus`), secret `INVITE_CODE`.
- **Sessions use a bearer token** kept in `localStorage`, not cookies: the site (vercel.app) and the Worker (workers.dev) are different sites, and Safari blocks third-party cookies. Only the SHA-256 of a token is stored.
- **Reads** are public: `GET /api/library` returns every non-deleted book in the shape `src/images.js` already understands (this replaces `library.json`).
- **Uploads** go through the Worker into R2 (no S3 keys in the browser). The browser encodes pages to WebP (three widths) itself, so no server-side image processing is needed. Books uploaded this way have no AVIF; the two existing books keep theirs.

## Data (D1)
- `users(id, username UNIQUE, display_name, slug UNIQUE, created_at)`
- `sessions(token_hash PK, user_id, created_at, last_used_at)`
- `books(id, owner_id, title, meta, pdf_key, manifest JSON, created_at, deleted_at)`
- `audit(id, user_id, action, book_id, at)`

## API
- `POST /api/register {invite, username, displayName}` → `{token, user}`
- `POST /api/login {invite, username}` → `{token, user}`
- `GET /api/me`, `POST /api/logout`
- `GET /api/library`
- `POST /api/books` (draft, returns an id) → `PUT /api/upload/:bookId/:name` per file → `POST /api/books/:id/publish {title, meta, pages}`
- `DELETE /api/books/:id` (owner, or the owner of the site)

## Phases
1. Worker, schema, register/login/me/library, tested locally.
2. Deploy the Worker; sign-in UI on the site.
3. Upload UI (browser WebP encoding), publish, delete.
4. Switch the site to `GET /api/library`, personal libraries, migrate the two current books.

## Open
- Co-authored books (Simple, on purpose has two authors): one owner for now.
- Rate limiting on login attempts.
