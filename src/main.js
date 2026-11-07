import './styles.css';
import { books, libraryError } from './images.js';
import { createBook } from './book.js';
import { sheetSize } from './leporello.js';
import { auth } from './auth.js';

if (libraryError) {
  document.querySelector('[data-hint]').textContent = 'The library could not be loaded. Try again in a moment.';
  throw new Error('[tubus] the library could not be loaded');
}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// --- Preferences (per-visitor convenience only) ---------------------------
const prefs = (() => {
  let data = {};
  try { data = JSON.parse(localStorage.getItem('deliberation') || '{}'); } catch {}
  return {
    get: (k, d) => (k in data ? data[k] : d),
    set: (k, v) => {
      data[k] = v;
      try { localStorage.setItem('deliberation', JSON.stringify(data)); } catch {}
    },
  };
})();

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => motionQuery.matches;
const mobile = () => matchMedia('(max-width: 700px)').matches;

const stage = $('#stage');
const hint = $('[data-hint]');
const vector = $('#opt-vector');
const zigzag = $('#opt-zigzag');
const modeButtons = $$('.modes [data-mode]');
let vectorPref = prefs.get('vector', false);

// --- Books -----------------------------------------------------------------
const shelf = books.map((data) =>
  createBook(data, {
    stage,
    bookTpl: $('#book-tpl'),
    zoomTpl: $('#zoom-tpl'),
    reducedMotion,
    mobile,
    vectorChecked: () => vector.checked,
    setHint: (t) => (hint.textContent = t),
    onMode: (m) => {
      document.body.dataset.mode = m;
      modeButtons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === m));
    },
    replaceHash: (h) => {
      history.replaceState(null, '', `#${h}`);
      lastHash = `#${h}`;
    },
  }),
);
let active = null; // the open book; null = the library
let lastHash = null; // the hash applyRoute last acted on (popstate and hashchange both fire for one navigation)
let routeToken = 0; // a newer route cancels a library exit that is still folding

// --- Library: the books stand side by side, a click brings one forward ------
const GAP = 1.35; // distance between book centres, in book widths
let libraryFilter = null; // slug of the person whose shelf is shown; null = everyone
const isShown = (book) => !libraryFilter || book.data.authorSlug === libraryFilter;
const hits = shelf.map((book) => {
  const hit = document.createElement('button');
  hit.type = 'button';
  hit.className = 'lib-hit';
  hit.setAttribute('aria-label', `Open ${book.data.title}`);
  hit.innerHTML = '<span class="lib-label"><strong></strong><span class="lib-author"></span><span class="dim"></span></span>';
  $('strong', hit).textContent = book.data.title;
  $('.lib-author', hit).textContent = book.data.author || '';
  $('.dim', hit).textContent = book.data.meta || '';
  hit.addEventListener('click', () => navigate(`${book.id}/folded`));
  const lift = (on) => () => book.el.classList.toggle('hover', on);
  hit.addEventListener('pointerenter', lift(true));
  hit.addEventListener('pointerleave', lift(false));
  hit.addEventListener('focus', lift(true));
  hit.addEventListener('blur', lift(false));
  $('[data-library]').append(hit);
  return hit;
});

/** Sets where each closed book stands (and where its click target is). Pure maths, no layout is animated. */
function layoutLibrary() {
  if (!shelf.length) return;
  const lepRoot = $('[data-lep]', shelf[0].el);
  const vw = lepRoot.clientWidth;
  const vh = lepRoot.clientHeight;
  if (!vw) return;
  const { w, h } = sheetSize(vw, vh);
  const shown = shelf.filter(isShown); // the others slide out and fade
  const n = Math.max(1, shown.length);
  const s = Math.min(0.62, (stage.clientWidth * 0.9) / (w * (GAP * (n - 1) + 1)));
  const lift = -18; // leaves room for the label under the books
  const centreY = (vh - stage.clientHeight) / 2; // book centre relative to the stage centre, unscaled
  shelf.forEach((book, i) => {
    const k = shown.indexOf(book);
    book.el.classList.toggle('filtered-out', k < 0);
    hits[i].hidden = k < 0;
    const x = k >= 0 ? (k - (n - 1) / 2) * w * s * GAP : (i - (shelf.length - 1) / 2) * w * s * GAP * 2.4;
    book.el.style.setProperty('--lx', `${x}px`);
    book.el.style.setProperty('--ly', `${lift}px`);
    book.el.style.setProperty('--ls', s);
    hits[i].style.setProperty('--hx', `${x}px`);
    hits[i].style.setProperty('--hy', `${centreY * s + lift}px`);
    hits[i].style.setProperty('--hw', `${w * s * 1.1}px`);
    hits[i].style.setProperty('--hh', `${h * s}px`);
  });
}
new ResizeObserver(layoutLibrary).observe(stage);
layoutLibrary();

// --- Header / footer follow the open book -----------------------------------
const titleEl = $('[data-title]');
const authorEl = $('[data-author]');
const metaEl = $('[data-meta]');
const download = $('[data-download]');
const countEl = $('[data-count]');
const emptyEl = $('[data-library-empty]');

function renderChrome() {
  const data = active?.data;
  const nb = shelf.length;
  countEl.textContent = `${nb} leporello${nb === 1 ? '' : 's'}${people.length ? ` · ${people.length} ${people.length === 1 ? 'person' : 'people'}` : ''}`;

  const shown = shelf.filter(isShown).length;
  const who = people.find((p) => p.slug === libraryFilter);
  emptyEl.hidden = shown > 0;
  emptyEl.textContent = libraryFilter ? `${who?.name || 'This person'} has not published anything yet.` : 'No leporellos yet.';
  titleEl.textContent = data ? data.title : 'Tubus';
  authorEl.textContent = data?.author || '';
  metaEl.textContent = data?.meta || '';
  document.title = data ? `${data.title} — ${data.author}` : 'Tubus — Dmitrii Demidov';

  download.hidden = !data?.pdfUrl;
  if (data?.pdfUrl) download.href = data.pdfUrl;

  const hasPdf = !!data?.pdfUrl;
  vector.disabled = !hasPdf;
  vector.parentElement.title = hasPdf ? '' : 'Add the PDF to this book\'s folder in /pages to enable';
  vector.checked = hasPdf && vectorPref;

  if (!active) {
    hint.textContent = mobile() ? 'Tap a book to open' : 'Click a book to open';
    modeButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    delete document.body.dataset.mode;
  }
}

// --- People: everyone in the library, and each person's own shelf -----------------
let people = []; // [{ name, slug, books, me }]
let peopleAt = 0;
const peopleNav = $('[data-people]');

const initials = (name) => name.split(/\s+/).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();
function avatarColour(slug) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 38% 34%)`;
}

function personChip(slug, name, count, me = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = slug ? 'person' : 'person person--all';
  b.setAttribute('aria-pressed', slug === libraryFilter);
  if (me) b.title = `${name} (you)`;
  if (slug) {
    const av = document.createElement('span');
    av.className = 'avatar';
    av.textContent = initials(name);
    av.style.background = avatarColour(slug);
    b.append(av);
  }
  const label = document.createElement('span');
  label.textContent = slug ? name : 'All';
  const n = document.createElement('span');
  n.className = 'count';
  n.textContent = count;
  b.append(label, n);
  b.addEventListener('click', () => navigate(slug ? `u/${slug}` : ''));
  return b;
}

function renderPeople() {
  peopleNav.replaceChildren(
    personChip(null, 'All', shelf.length),
    ...people.map((p) => personChip(p.slug, p.name, p.books, p.me)),
  );
  peopleNav.hidden = !auth.user || !people.length;
}

async function loadPeople(force = false) {
  if (!auth.user || (!force && Date.now() - peopleAt < 20000)) return;
  peopleAt = Date.now();
  try {
    people = (await auth.call('/people')).people;
  } catch {
    return; // keep what we have
  }
  renderPeople();
  renderChrome();
}

function setFilter(slug) {
  libraryFilter = slug;
  layoutLibrary();
  renderPeople();
  renderChrome();
  peopleNav.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}
const libraryHash = () => (libraryFilter ? `u/${libraryFilter}` : '');

// --- Routing: #<book>/folded · #<book>/unfolded · #<book>/page-N · #u/<person> · (empty = the whole library)
const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function parseHash() {
  const raw = location.hash.slice(1);
  if (!raw) return null;
  const parts = raw.split('/');
  if (parts[0] === 'u' && parts[1]) return { person: decodeURIComponent(parts[1]) };
  // Books are found by id, or by the slug of their title (old links: #deliberation/unfolded).
  let book = shelf.find((x) => x.id === parts[0] || slugOf(x.data.title) === parts[0]);
  const rest = book ? parts[1] : raw; // older links (#page-5, #unfolded) belong to the first book
  const page = (rest || '').match(/^page-(\d+)$/);
  if (!book && !page && rest !== 'folded' && rest !== 'unfolded') return null;
  book ||= shelf[0];
  if (!book) return null;
  if (page) return { book, mode: 'pages', page: +page[1] - 1 };
  return { book, mode: rest === 'unfolded' ? 'unfolded' : 'folded' };
}

let zoomTimer = 0;
function travel() {
  document.body.classList.add('zooming');
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => document.body.classList.remove('zooming'), 1000);
}

/** Closes an open strip first, then lets the library take over. */
async function showLibrary(token) {
  if (!active) return;
  const leaving = active;
  leaving.el.inert = true; // no clicks while it closes
  await leaving.foldAway();
  if (token !== routeToken || active !== leaving) return;
  active = null;
  travel();
  document.body.dataset.view = 'library';
  shelf.forEach((b) => {
    b.el.classList.remove('current');
    b.el.inert = true;
  });
  leaving.close();
  renderChrome();
}

function openBook(route) {
  const { book } = route;
  book.el.inert = false; // may still be locked by a library exit that this route cancels
  if (active !== book) {
    const from = active;
    from?.close();
    active = book;
    travel();
    document.body.dataset.view = 'book';
    shelf.forEach((b) => {
      b.el.classList.toggle('current', b === book);
      b.el.inert = b !== book;
    });
    renderChrome();
    if (vector.checked) book.verifyVector();
  }
  if (route.page != null) book.goTo(route.page);
  book.setMode(route.mode, { instant: true });
}

function applyRoute() {
  if (location.hash === lastHash) return;
  lastHash = location.hash;
  const token = ++routeToken;
  const route = parseHash();
  if (route?.book) return openBook(route);
  setFilter(route?.person ?? null);
  loadPeople();
  showLibrary(token);
}

function navigate(hash) {
  if (location.hash === (hash ? `#${hash}` : '')) return;
  history.pushState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  applyRoute();
}

addEventListener('hashchange', applyRoute);
addEventListener('popstate', applyRoute);
$('[data-back]').addEventListener('click', () => navigate(libraryHash()));
addEventListener('focus', () => loadPeople());

// --- Mode buttons ---------------------------------------------------------------
modeButtons.forEach((b) => b.addEventListener('click', () => active && !active.el.inert && active.setMode(b.dataset.mode)));

// --- Keyboard ---------------------------------------------------------------
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && profileOpen()) return closeProfile();
  if (!active || active.zoomOpen || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === 'Escape' && settingsPanel.hidden) {
    e.preventDefault();
    navigate(libraryHash());
    return;
  }
  active.handleKey(e);
});

// --- Settings ----------------------------------------------------------------
const settingsBtn = $('.settings-btn');
const settingsPanel = $('#settings-panel');
function closeSettings() {
  settingsPanel.hidden = true;
  settingsBtn.setAttribute('aria-expanded', 'false');
}
settingsBtn.addEventListener('click', () => {
  const open = settingsPanel.hidden;
  settingsPanel.hidden = !open;
  settingsBtn.setAttribute('aria-expanded', open);
});
document.addEventListener('click', (e) => {
  if (!settingsPanel.hidden && !e.target.closest('.settings')) closeSettings();
  if (!accountPanel.hidden && !e.target.closest('.account')) closeAccountMenu();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsPanel.hidden) closeSettings();
});

zigzag.checked = prefs.get('zigzag', false);
shelf.forEach((b) => b.lep.setZigzag(zigzag.checked, true));
zigzag.addEventListener('change', () => {
  prefs.set('zigzag', zigzag.checked);
  shelf.forEach((b) => b.lep.setZigzag(zigzag.checked));
});

vector.addEventListener('change', async () => {
  vectorPref = vector.checked;
  prefs.set('vector', vectorPref);
  if (!active) return;
  if (!vector.checked) return active.clearVector();
  if (!(await active.verifyVector())) vector.checked = false;
});

// --- Account: the sign-in page and the account menu ------------------------------
const accountBtn = $('.account-btn');
const accountPanel = $('#account-panel');
const authPage = $('[data-auth-page]');
const authForm = $('#auth-form');
const authError = $('[data-auth-error]');
const authSubmit = $('[data-auth-submit]');
const appShell = $$('.top, .stage, .bottom');
const profilePage = $('[data-profile-page]');
const nameForm = $('#name-form');
const usernameForm = $('#username-form');
const nameMessage = $('[data-name-message]');
const usernameMessage = $('[data-username-message]');
const profileOpen = () => document.documentElement.classList.contains('profile-open');
let creating = false;

const AUTH_ERRORS = {
  bad_invite: 'That invite code is not right.',
  bad_username: 'Username: 3–24 characters, a–z, 0–9, dot, dash or underscore.',
  bad_display_name: 'Your name should be 2–40 characters.',
  username_taken: 'That username is taken. Pick another.',
  no_such_user: 'No account with that username. New here? Choose “Create account”.',
  network: 'Cannot reach the server. Check your connection and try again.',
  not_signed_in: 'Your session expired. Please sign in again.',
};

function closeAccountMenu() {
  accountPanel.hidden = true;
  accountBtn.setAttribute('aria-expanded', 'false');
}

function setAuthMode(createAccount) {
  creating = createAccount;
  $('[data-auth-title]').textContent = creating ? 'Create your account' : 'Sign in to Tubus';
  authSubmit.textContent = creating ? 'Create account' : 'Sign in';
  $('[data-username-hint]').textContent = creating
    ? 'Private, never shown. 3–24 characters: a–z, 0–9, dot, dash, underscore.'
    : 'The one you chose when you signed up.';
  $('[data-register-only]').hidden = !creating;
  $$('[data-auth-tab]').forEach((b) => b.setAttribute('aria-pressed', (b.dataset.authTab === 'register') === creating));
  authError.textContent = '';
}

/** Signed out: only the sign-in page is usable. Signed in: the site as usual. */
function renderAccount() {
  const user = auth.user;
  const wasOut = document.documentElement.classList.contains('signed-out');
  document.documentElement.classList.toggle('signed-out', !user);
  appShell.forEach((el) => (el.inert = !user || profileOpen()));
  accountBtn.textContent = user?.displayName || '';
  closeAccountMenu();
  if (!user && !wasOut) {
    // Just signed out: start from a clean form.
    authForm.reset();
    setAuthMode(false);
  }
  if (!user) authForm.elements.invite.focus({ preventScroll: true });
  else if (wasOut) document.activeElement?.blur();
}

const say = (el, text, ok = false) => {
  el.textContent = text;
  el.classList.toggle('is-ok', ok);
};
const normalizeUsername = (v) => v.replace(/\s+/g, ' ').trim().toLowerCase();

const usernameValue = $('[data-username-value]');
const usernameEye = $('[data-username-eye]');
const MASK = '••••••••';

/** The username is hidden by default; the eye reveals it for as long as the page stays open. */
function showUsername(on) {
  usernameEye.setAttribute('aria-pressed', on);
  usernameEye.setAttribute('aria-label', on ? 'Hide username' : 'Show username');
  usernameEye.title = on ? 'Hide username' : 'Show username';
  usernameValue.textContent = on ? auth.user.username : MASK;
  usernameValue.classList.toggle('is-shown', on);
  if (on) {
    usernameValue.removeAttribute('role');
    usernameValue.removeAttribute('aria-label');
  } else {
    usernameValue.setAttribute('role', 'img');
    usernameValue.setAttribute('aria-label', 'Hidden');
  }
}

usernameEye.addEventListener('click', async () => {
  if (usernameEye.getAttribute('aria-pressed') === 'true') return showUsername(false);
  if (!auth.user.username) await auth.refresh(); // a session saved by an older version has no username
  if (auth.user?.username) showUsername(true);
});

function setEditingUsername(on) {
  usernameForm.hidden = !on;
  $('[data-username-edit]').hidden = on;
  if (on) {
    usernameForm.reset();
    usernameForm.elements.username.focus({ preventScroll: true });
  }
}

function openProfile() {
  nameForm.elements.displayName.value = auth.user.displayName;
  say(nameMessage, '');
  say(usernameMessage, '');
  setEditingUsername(false);
  showUsername(false);
  closeAccountMenu();
  document.documentElement.classList.add('profile-open');
  appShell.forEach((el) => (el.inert = true));
  nameForm.elements.displayName.focus({ preventScroll: true });
}

function closeProfile() {
  document.documentElement.classList.remove('profile-open');
  usernameForm.reset();
  showUsername(false);
  appShell.forEach((el) => (el.inert = !auth.user));
  document.activeElement?.blur();
}

$('[data-profile-open]').addEventListener('click', openProfile);
$('[data-profile-close]').addEventListener('click', closeProfile);
$('[data-username-edit]').addEventListener('click', () => {
  say(usernameMessage, '');
  setEditingUsername(true);
});
$('[data-username-cancel]').addEventListener('click', () => {
  say(usernameMessage, '');
  setEditingUsername(false);
});

nameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  say(nameMessage, '');
  $('[data-name-submit]').disabled = true;
  try {
    await auth.updateProfile({ displayName: nameForm.elements.displayName.value });
    nameForm.elements.displayName.value = auth.user.displayName;
    say(nameMessage, 'Saved.', true);
  } catch (err) {
    say(nameMessage, AUTH_ERRORS[err.code] || 'Something went wrong. Try again.');
  } finally {
    $('[data-name-submit]').disabled = false;
  }
});

usernameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const first = normalizeUsername(usernameForm.elements.username.value);
  const again = normalizeUsername(usernameForm.elements.confirm.value);
  say(usernameMessage, '');
  if (first !== again) return say(usernameMessage, 'The two usernames do not match.');
  $('[data-username-submit]').disabled = true;
  try {
    await auth.updateProfile({ username: first });
    setEditingUsername(false);
    showUsername(false);
    say(usernameMessage, 'Username changed. Use the new one the next time you sign in.', true);
  } catch (err) {
    say(usernameMessage, AUTH_ERRORS[err.code] || 'Something went wrong. Try again.');
  } finally {
    $('[data-username-submit]').disabled = false;
  }
});

accountBtn.addEventListener('click', () => {
  const open = accountPanel.hidden;
  accountPanel.hidden = !open;
  accountBtn.setAttribute('aria-expanded', open);
});
$('[data-signout]').addEventListener('click', () => auth.signOut());
$$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.authTab === 'register')));

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = authForm.elements;
  authError.textContent = '';
  authSubmit.disabled = true;
  try {
    const input = { invite: f.invite.value.trim(), username: f.username.value.trim() };
    if (creating) await auth.register({ ...input, displayName: f.displayName.value });
    else await auth.signIn(input);
    authForm.reset(); // a signed-in browser no longer needs the code on screen
  } catch (err) {
    authError.textContent = AUTH_ERRORS[err.code] || 'Something went wrong. Try again.';
  } finally {
    authSubmit.disabled = false;
  }
});

setAuthMode(false);
auth.onChange(renderAccount);
auth.onChange(() => {
  if (auth.user) loadPeople(true);
  else {
    people = [];
    renderPeople();
    renderChrome();
  }
});
renderAccount();
auth.refresh();

// --- Start ----------------------------------------------------------------------
shelf.forEach((b) => (b.el.inert = true));
renderChrome();
applyRoute();
loadPeople(true);
// Let the first frame settle in place, then switch the zoom transitions on.
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('booting')));
