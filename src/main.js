import './styles.css';
import { books, libraryError, fetchBooks, createPicture, hydrate } from './images.js';
import { createBook } from './book.js';
import { auth } from './auth.js';
import { createUploader } from './upload.js';

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

// --- Books -------------------------------------------------------------------
const bookCtx = {
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
};
const entries = []; // one per book: { id, data, card, book }. The 3D book is built when it is first opened.
let active = null; // the open book (its 3D view); null = the library
let lastHash = null; // the hash applyRoute last acted on (popstate and hashchange both fire for one navigation)
let routeToken = 0; // a newer route cancels a library exit that is still folding

// --- Library: flat covers in a grid; the 3D book only exists once it is opened ----
let libraryFilter = null; // slug of the person whose shelf is shown; null = everyone
const isShown = (entry) => !libraryFilter || entry.data.authorSlug === libraryFilter;
const shelfEl = $('[data-shelf]');
const grid = $('[data-grid]');

// Covers load as they come near the screen.
const coverIO = new IntersectionObserver((list) => {
  list.forEach((it) => {
    if (!it.isIntersecting) return;
    hydrate($('picture', it.target));
    coverIO.unobserve(it.target);
  });
}, { root: shelfEl, rootMargin: '400px' });

const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 150));

function makeCard(entry) {
  const { data } = entry;
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.setAttribute('aria-label', `Open ${data.title}`);
  card.innerHTML = '<span class="cover"></span><span class="card-label"><strong></strong><span class="lib-author"></span><span class="dim"></span></span>';
  const first = data.pages[0];
  if (first) {
    const { r, g, b } = first.paper || {};
    $('.cover', card).style.background = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
    $('.cover', card).append(createPicture(first, { sizes: '(max-width: 700px) 46vw, 260px' }));
  }
  $('strong', card).textContent = data.title;
  $('.lib-author', card).textContent = data.author || '';
  $('.dim', card).textContent = data.meta || '';
  card.addEventListener('click', () => navigate(`${data.id}/folded`));
  // Build the 3D book while the pointer is on its way to the click.
  const warm = () => idle(() => ensureBook(entry));
  card.addEventListener('pointerenter', warm, { once: true });
  card.addEventListener('focus', warm, { once: true });
  grid.append(card);
  coverIO.observe(card);
  return card;
}

function ensureBook(entry) {
  if (!entry.book) {
    const book = createBook(entry.data, bookCtx);
    book.el.inert = true;
    book.lep.setZigzag(zigzag.checked, true);
    book.lep.measure(); // sizes are known now, not on the next frame
    entry.book = book;
  }
  return entry.book;
}

function addEntry(data) {
  const entry = { id: data.id, data, card: null, book: null };
  entry.card = makeCard(entry);
  entries.push(entry);
  return entry;
}
books.forEach(addEntry);

function renderShelf() {
  entries.forEach((e) => (e.card.hidden = !isShown(e)));
}

/** Picks up books that were published since this page loaded. */
async function syncLibrary() {
  let fresh;
  try {
    fresh = await fetchBooks();
  } catch {
    return;
  }
  const added = fresh.filter((data) => !entries.some((e) => e.id === data.id));
  if (!added.length) return;
  added.forEach(addEntry);
  renderShelf();
  renderPeople();
  renderChrome();
}

// --- Flying between the grid and the 3D book ---------------------------------------
const flyers = new Set();
function clearFlyers() {
  flyers.forEach((f) => f.remove());
  flyers.clear();
  entries.forEach((e) => e.card.classList.remove('lifted'));
}
const coverBox = (entry) => $('.cover', entry.card).getBoundingClientRect();

function makeFlyer(entry, box) {
  const el = document.createElement('div');
  el.className = 'flyer';
  el.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;background:${$('.cover', entry.card).style.background}`;
  const src = $('img', entry.card)?.currentSrc;
  if (src) {
    const img = new Image();
    img.alt = '';
    img.src = src;
    el.append(img);
  }
  document.body.append(el);
  flyers.add(el);
  return el;
}

const glide = (el, a, b, ms) =>
  el.animate(
    [{ transform: 'translate(0, 0) scale(1, 1)' }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width}, ${b.height / a.height})` }],
    { duration: ms, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' },
  ).finished;

/** Waits until the 3D cover has its picture on screen, so swapping the flat cover for it shows no flash. */
async function coverSettled(book) {
  const img = $('.panel img', book.el);
  if (!img || img.classList.contains('loaded')) return;
  const t0 = performance.now();
  while (!img.classList.contains('loaded') && performance.now() - t0 < 2500) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 380)); // the picture fades in over 0.35 s
}

/**
 * The clicked cover glides onto the face of the closed stack (shown straight on), the
 * stack takes its place in one frame, and then the 3D scene itself turns into its resting view.
 */
async function flyIn(entry, book) {
  clearFlyers();
  const from = coverBox(entry);
  book.lep.setTilt(0);
  const to = book.lep.coverRect();
  const el = makeFlyer(entry, from);
  entry.card.classList.add('lifted');
  try {
    await glide(el, from, to, 750);
    await coverSettled(book);
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('[tubus] fly in', err); // an abort means a newer route removed the flyer
  }
  book.el.classList.remove('hold');
  if (!flyers.delete(el)) return book.lep.setTilt(1);
  el.remove();
  await book.lep.tiltTo(1, 950);
}

/** The closed stack (already turned face-on) becomes the flat cover and glides back to its place. */
async function flyOut(entry, from) {
  clearFlyers();
  if (entry.card.hidden) return;
  entry.card.scrollIntoView({ block: 'nearest' });
  const to = coverBox(entry);
  const el = makeFlyer(entry, from); // exactly over the 3D cover, which disappears in the same frame
  entry.card.classList.add('lifted');
  try {
    await glide(el, from, to, 750);
  } catch {}
  if (flyers.delete(el)) {
    el.remove();
    entry.card.classList.remove('lifted');
  }
}

// --- Header / footer follow the open book -----------------------------------
const titleEl = $('[data-title]');
const authorEl = $('[data-author]');
const metaEl = $('[data-meta]');
const download = $('[data-download]');
const emptyEl = $('[data-library-empty]');

function renderChrome() {
  const data = active?.data;
  const shown = entries.filter(isShown).length;
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

const norm = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CHEVRON = '<svg class="f-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

// The filter is a small control, so it stays tidy with fifteen people: All · Mine · a searchable list.
peopleNav.innerHTML = `
  <div class="people-wrap">
    <div class="filter-seg" role="group" aria-label="Show">
      <button type="button" data-f="all">All <span class="count"></span></button>
      <button type="button" data-f="mine">Mine <span class="count"></span></button>
      <button type="button" data-f="person" aria-haspopup="listbox" aria-expanded="false"><span class="f-label">People</span>${CHEVRON}</button>
    </div>
    <div class="people-menu" hidden>
      <input type="search" class="people-search" placeholder="Search people" aria-label="Search people" autocomplete="off" spellcheck="false" />
      <div class="people-list" role="listbox" aria-label="People"></div>
      <p class="people-none dim" hidden>No one found.</p>
    </div>
  </div>`;
const fAll = $('[data-f="all"]', peopleNav);
const fMine = $('[data-f="mine"]', peopleNav);
const fPerson = $('[data-f="person"]', peopleNav);
const peopleMenu = $('.people-menu', peopleNav);
const peopleSearch = $('.people-search', peopleNav);
const peopleList = $('.people-list', peopleNav);
const peopleNone = $('.people-none', peopleNav);

const menuIsOpen = () => !peopleMenu.hidden;
function closePeopleMenu() {
  peopleMenu.hidden = true;
  fPerson.setAttribute('aria-expanded', 'false');
}
function openPeopleMenu() {
  peopleSearch.value = '';
  filterPeopleList();
  peopleMenu.hidden = false;
  fPerson.setAttribute('aria-expanded', 'true');
  peopleSearch.focus({ preventScroll: true });
}
const visibleRows = () => $$('.person-row:not([hidden])', peopleList);

function filterPeopleList() {
  const q = norm(peopleSearch.value.trim());
  let shown = 0;
  $$('.person-row', peopleList).forEach((row) => {
    const ok = !q || norm(row.dataset.name).includes(q);
    row.hidden = !ok;
    if (ok) shown++;
  });
  peopleNone.hidden = shown > 0;
}

function personRow(p) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'person-row';
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', p.slug === libraryFilter);
  row.dataset.name = p.name;
  const av = document.createElement('span');
  av.className = 'avatar';
  av.textContent = initials(p.name);
  av.style.background = avatarColour(p.slug);
  const name = document.createElement('span');
  name.className = 'person-name';
  name.textContent = p.me ? `${p.name} (you)` : p.name;
  const n = document.createElement('span');
  n.className = 'count';
  n.textContent = p.books;
  row.append(av, name, n);
  row.addEventListener('click', () => {
    closePeopleMenu();
    navigate(`u/${p.slug}`);
  });
  return row;
}

function renderPeople() {
  const me = people.find((p) => p.me);
  const other = libraryFilter && libraryFilter !== me?.slug ? people.find((p) => p.slug === libraryFilter) : null;

  fAll.setAttribute('aria-pressed', libraryFilter === null);
  $('.count', fAll).textContent = entries.length;
  fMine.hidden = !me;
  fMine.setAttribute('aria-pressed', !!me && libraryFilter === me.slug);
  $('.count', fMine).textContent = me?.books ?? 0;
  fPerson.setAttribute('aria-pressed', !!other);
  $('.f-label', fPerson).textContent = other ? other.name : 'People';

  // Me first, then everyone else A–Z.
  const sorted = [...people].sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
  peopleList.replaceChildren(...sorted.map(personRow));
  filterPeopleList();
  peopleNav.hidden = !auth.user || !people.length;
}

fAll.addEventListener('click', () => navigate(''));
fMine.addEventListener('click', () => {
  const me = people.find((p) => p.me);
  if (me) navigate(`u/${me.slug}`);
});
fPerson.addEventListener('click', () => (menuIsOpen() ? closePeopleMenu() : openPeopleMenu()));
peopleSearch.addEventListener('input', filterPeopleList);
peopleSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') visibleRows()[0]?.click();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    visibleRows()[0]?.focus();
  }
});
peopleList.addEventListener('keydown', (e) => {
  const rows = visibleRows();
  const i = rows.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') rows[Math.min(rows.length - 1, i + 1)]?.focus();
  else if (e.key === 'ArrowUp') (i <= 0 ? peopleSearch : rows[i - 1]).focus();
  else return;
  e.preventDefault();
});
document.addEventListener('click', (e) => menuIsOpen() && !e.target.closest('.people-wrap') && closePeopleMenu());

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
  renderShelf();
  shelfEl.scrollTop = 0;
  renderPeople();
  renderChrome();
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
  let entry = entries.find((x) => x.id === parts[0] || slugOf(x.data.title) === parts[0]);
  const rest = entry ? parts[1] : raw; // older links (#page-5, #unfolded) belong to the first book
  const page = (rest || '').match(/^page-(\d+)$/);
  if (!entry && !page && rest !== 'folded' && rest !== 'unfolded') return null;
  entry ||= entries[0];
  if (!entry) return null;
  if (page) return { entry, mode: 'pages', page: +page[1] - 1 };
  return { entry, mode: rest === 'unfolded' ? 'unfolded' : 'folded' };
}

/** Closes an open strip first, then lets the library take over. */
async function showLibrary(token) {
  if (!active) return;
  const leaving = active;
  leaving.el.inert = true; // no clicks while it closes
  await leaving.foldAway();
  if (token !== routeToken || active !== leaving) return;
  leaving.close(); // the closed stack, whatever mode the book was in
  if (!reducedMotion()) {
    await leaving.lep.tiltTo(0, 600); // turn it face-on, ready to become the flat cover again
    if (token !== routeToken || active !== leaving) return;
  }
  const from = leaving.lep.coverRect();
  const entry = entries.find((e) => e.book === leaving);
  active = null;
  document.body.dataset.view = 'library';
  const handOver = entry && !reducedMotion(); // the flat cover takes over at once, no cross-fade
  if (handOver) leaving.el.classList.add('snap');
  entries.forEach((e) => {
    if (!e.book) return;
    e.book.el.classList.remove('current');
    e.book.el.inert = true;
  });
  if (handOver) setTimeout(() => leaving.el.classList.remove('snap'), 80);
  renderChrome();
  if (entry && !reducedMotion()) flyOut(entry, from);
}

function openBook(route) {
  const { entry } = route;
  const book = ensureBook(entry);
  book.el.inert = false; // may still be locked by a library exit that this route cancels
  if (active !== book) {
    const from = active;
    from?.close();
    active = book;
    document.body.dataset.view = 'book';
    entries.forEach((e) => {
      if (!e.book) return;
      e.book.el.classList.toggle('current', e.book === book);
      e.book.el.inert = e.book !== book;
    });
    renderChrome();
    if (vector.checked) book.verifyVector();
    // Coming from the library: the cover flies in (no flight on a page load or with reduced motion).
    if (!from && !document.body.classList.contains('booting') && !reducedMotion()) {
      book.el.classList.add('hold'); // the flat cover is in the air; the stack shows once it lands
      flyIn(entry, book);
    } else {
      book.lep.setTilt(1);
    }
  }
  if (route.page != null) book.goTo(route.page);
  book.setMode(route.mode, { instant: true });
}

function applyRoute() {
  if (location.hash === lastHash) return;
  lastHash = location.hash;
  const token = ++routeToken;
  const route = parseHash();
  if (route?.entry) return openBook(route);
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
addEventListener('focus', () => {
  loadPeople();
  syncLibrary();
});
setInterval(() => document.visibilityState === 'visible' && auth.user && (loadPeople(), syncLibrary()), 60000);

// --- Mode buttons ---------------------------------------------------------------
modeButtons.forEach((b) => b.addEventListener('click', () => active && !active.el.inert && active.setMode(b.dataset.mode)));

// --- Keyboard ---------------------------------------------------------------
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menuIsOpen()) return closePeopleMenu();
  if (e.key === 'Escape' && profileOpen()) return closeProfile();
  if (e.key === 'Escape' && uploadOpen()) return uploader.busy || closeUpload();
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
entries.forEach((e) => e.book?.lep.setZigzag(zigzag.checked, true));
zigzag.addEventListener('change', () => {
  prefs.set('zigzag', zigzag.checked);
  entries.forEach((e) => e.book?.lep.setZigzag(zigzag.checked));
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
const uploadOpen = () => document.documentElement.classList.contains('upload-open');
const overlayOpen = () => profileOpen() || uploadOpen();
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
  appShell.forEach((el) => (el.inert = !user || overlayOpen()));
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

const uploadPage = $('[data-upload-page]');
const uploader = createUploader(uploadPage, {
  onClose: () => closeUpload(),
  onPublished: async () => {
    closeUpload();
    await syncLibrary();
    await loadPeople(true);
    if (auth.user) navigate(`u/${auth.user.slug}`); // show the new book on its author's shelf
  },
});

function openUpload() {
  closeAccountMenu();
  uploader.reset();
  document.documentElement.classList.add('upload-open');
  appShell.forEach((el) => (el.inert = true));
}

function closeUpload() {
  document.documentElement.classList.remove('upload-open');
  appShell.forEach((el) => (el.inert = !auth.user));
  document.activeElement?.blur();
}

$('[data-upload-open]').addEventListener('click', openUpload);

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
renderChrome();
applyRoute();
loadPeople(true);
// Let the first frame settle in place, then switch the zoom transitions on.
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('booting')));
