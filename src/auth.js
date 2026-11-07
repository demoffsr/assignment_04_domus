// Session for the Tubus API. The token lives in localStorage and is sent as a
// bearer header (cookies would be third-party for the Worker, and Safari blocks those).
const API = `${(import.meta.env.VITE_API_URL || 'https://tubus-api.ustimdima2002.workers.dev').replace(/\/$/, '')}/api`;
export const API_URL = API;
const KEY = 'tubus.session';

let session = null; // { token, user: { id, displayName, slug } }
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}

const listeners = new Set();
function save(next) {
  session = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((fn) => fn());
}

/** Calls the API. Errors carry `.code` (the API's error code, or 'network') and `.status`. */
async function call(path, { method = 'GET', body, headers, signal } = {}) {
  const raw = body instanceof Blob; // files go as they are, everything else as JSON
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        ...(body && !raw ? { 'content-type': 'application/json' } : {}),
        ...(session ? { authorization: `Bearer ${session.token}` } : {}),
        ...headers,
      },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err; // the person cancelled
    throw Object.assign(new Error('network'), { code: 'network' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session) save(null); // the session expired or was revoked
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error || 'server_error', status: res.status });
  return data;
}

export const auth = {
  call,
  get user() { return session?.user ?? null; },
  get token() { return session?.token ?? null; },
  onChange(fn) { listeners.add(fn); },

  async register({ invite, username, displayName }) {
    save(await call('/register', { method: 'POST', body: { invite, username, displayName } }));
  },
  async signIn({ invite, username }) {
    save(await call('/login', { method: 'POST', body: { invite, username } }));
  },
  async updateProfile({ username, displayName }) {
    const { user } = await call('/me', { method: 'PATCH', body: { username, displayName } });
    save({ ...session, user });
  },
  async signOut() {
    try { await call('/logout', { method: 'POST' }); } catch {}
    save(null);
  },
  /** Checks the stored session is still valid (the display name may also have changed). */
  async refresh() {
    if (!session) return;
    try {
      const { user } = await call('/me');
      save({ ...session, user });
    } catch (err) {
      if (err.status === 401) save(null);
    }
  },
};
