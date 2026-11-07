import './styles.css';
import { books } from './images.js';
import { createBook } from './book.js';
import { sheetSize } from './leporello.js';

if (!books.length) {
  document.querySelector('[data-hint]').textContent = 'The library could not be loaded. Try again in a moment.';
  throw new Error('[tubus] no books to show');
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
const hits = shelf.map((book) => {
  const hit = document.createElement('button');
  hit.type = 'button';
  hit.className = 'lib-hit';
  hit.setAttribute('aria-label', `Open ${book.data.title}`);
  hit.innerHTML = '<span class="lib-label"><strong></strong><span class="dim"></span></span>';
  $('strong', hit).textContent = book.data.title;
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
  const lepRoot = $('[data-lep]', shelf[0].el);
  const vw = lepRoot.clientWidth;
  const vh = lepRoot.clientHeight;
  if (!vw) return;
  const { w, h } = sheetSize(vw, vh);
  const n = shelf.length;
  const s = Math.min(0.62, (stage.clientWidth * 0.9) / (w * (GAP * (n - 1) + 1)));
  const lift = -18; // leaves room for the label under the books
  const centreY = (vh - stage.clientHeight) / 2; // book centre relative to the stage centre, unscaled
  shelf.forEach((book, i) => {
    const x = (i - (n - 1) / 2) * w * s * GAP;
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
$('[data-count]').textContent = `${shelf.length} leporellos`;

function renderChrome() {
  const data = active?.data;
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

// --- Routing: #<book>/folded · #<book>/unfolded · #<book>/page-N · (empty = library)
function parseHash() {
  const raw = location.hash.slice(1);
  if (!raw) return null;
  const parts = raw.split('/');
  let book = shelf.find((b) => b.id === parts[0]);
  const rest = book ? parts[1] : raw; // old links (#page-5, #unfolded) belong to the first book
  const page = (rest || '').match(/^page-(\d+)$/);
  if (!book && !page && rest !== 'folded' && rest !== 'unfolded') return null;
  book ||= shelf[0];
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
  if (route) openBook(route);
  else showLibrary(token);
}

function navigate(hash) {
  if (location.hash === (hash ? `#${hash}` : '')) return;
  history.pushState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  applyRoute();
}

addEventListener('hashchange', applyRoute);
addEventListener('popstate', applyRoute);
$('[data-back]').addEventListener('click', () => navigate(''));

// --- Mode buttons ---------------------------------------------------------------
modeButtons.forEach((b) => b.addEventListener('click', () => active && !active.el.inert && active.setMode(b.dataset.mode)));

// --- Keyboard ---------------------------------------------------------------
addEventListener('keydown', (e) => {
  if (!active || active.zoomOpen || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === 'Escape' && settingsPanel.hidden) {
    e.preventDefault();
    navigate('');
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

// --- Start ----------------------------------------------------------------------
shelf.forEach((b) => (b.el.inert = true));
renderChrome();
applyRoute();
// Let the first frame settle in place, then switch the zoom transitions on.
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('booting')));
