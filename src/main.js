import './styles.css';
import { pages, pdfUrl, createPicture, hydrate } from './images.js';
import { createPageView } from './pageview.js';
import { createLeporello } from './leporello.js';
import { createZoom } from './zoom.js';

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

let mode = null;
let current = 0; // page index shared by all modes
const vectorOn = () => $('#opt-vector').checked && !!pdfUrl;

// --- Views ----------------------------------------------------------------
const lepView = $('.view-lep');
const pagesView = $('.view-pages');
const unfoldBtn = $('[data-unfold]');
const hint = $('[data-hint]');

const zoom = createZoom($('[data-zoom]'), pages, {
  vector: vectorOn,
  renderVector: (i, w) => import('./pdf.js').then((m) => m.renderPage(pdfUrl, i, w)),
  onNavigate: (d) => {
    const i = Math.min(pages.length - 1, Math.max(0, zoom.index + d));
    zoom.show(i);
    setCurrent(i);
    if (mode === 'pages') pv.goTo(i, { instant: true });
  },
});

const pv = createPageView($('[data-pv]'), pages, {
  reducedMotion,
  onOpen: (i) => zoom.open(i),
  onChange: (i) => setCurrent(i),
});

const lep = createLeporello($('[data-lep]'), pages, {
  reducedMotion,
  onOpen: (i) => zoom.open(i),
  onIndex: (i) => setCurrent(i),
});
lep.onUnfoldRequest(() => setMode('unfolded'));

// --- Page-by-page chrome: counter, arrows, thumbnails ---------------------
const counter = $('[data-counter]');
const sectionLabel = $('[data-section]');
const thumbs = $('[data-thumbs]');

const thumbButtons = pages.map((page, i) => {
  if (page.section && page.section !== pages[i - 1]?.section) {
    const label = document.createElement('span');
    label.className = 'thumb-section';
    label.textContent = page.section;
    thumbs.append(label);
  }
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'thumb';
  b.setAttribute('role', 'tab');
  b.setAttribute('aria-label', `${i + 1}. ${page.title}`);
  b.title = page.title;
  b.append(createPicture(page, { sizes: '44px' }));
  b.addEventListener('click', () => pv.goTo(i));
  thumbs.append(b);
  return b;
});
const thumbIO = new IntersectionObserver((entries) => {
  entries.forEach((e) => e.isIntersecting && hydrate(e.target.querySelector('picture')));
}, { root: thumbs, rootMargin: '0px 200px' });
thumbButtons.forEach((b) => thumbIO.observe(b));

function setCurrent(i) {
  current = i;
  const page = pages[i];
  counter.textContent = `${i + 1} / ${pages.length}`;
  sectionLabel.textContent = page.section ? `${page.section} ·` : '';
  thumbButtons.forEach((b, k) => {
    const on = k === i;
    b.setAttribute('aria-selected', on);
    b.tabIndex = on ? 0 : -1;
  });
  if (mode === 'pages') {
    const b = thumbButtons[i];
    thumbs.scrollTo({ left: b.offsetLeft - thumbs.clientWidth / 2 + b.offsetWidth / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
    $('[data-prev]').disabled = i === 0;
    $('[data-next]').disabled = i === pages.length - 1;
    history.replaceState(null, '', `#page-${i + 1}`);
    scheduleVector();
  }
}

$('[data-prev]').addEventListener('click', () => pv.prev());
$('[data-next]').addEventListener('click', () => pv.next());

// --- Vector (PDF.js) overlay for the focused page --------------------------
let vecTimer = 0;
function scheduleVector() {
  clearTimeout(vecTimer);
  if (!vectorOn() || mode !== 'pages') return;
  vecTimer = setTimeout(async () => {
    const panel = pv.focusPanel();
    const i = +panel.el.dataset.index;
    const { renderPage } = await import('./pdf.js');
    const canvas = await renderPage(pdfUrl, i, pv.width);
    if (!canvas || !vectorOn() || i !== current) return;
    canvas.className = 'vector';
    const front = panel.el.querySelector('.front');
    front.querySelector('.vector')?.remove();
    front.insertBefore(canvas, front.querySelector('.edge'));
  }, 400);
}
function clearVector() {
  $$('.panel .vector').forEach((c) => c.remove());
}

// --- Modes ----------------------------------------------------------------
function show(view) {
  for (const v of [lepView, pagesView]) {
    const on = v === view;
    if (on) v.hidden = false;
    v.classList.toggle('active', on);
    v.inert = !on;
    if (!on) setTimeout(() => !v.classList.contains('active') && (v.hidden = true), 400);
  }
}

function setMode(next, { instant = false } = {}) {
  if (next === mode) return;
  const prev = mode;
  mode = next;
  document.body.dataset.mode = next;
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === next));

  if (next === 'pages') {
    show(pagesView);
    clearVector();
    requestAnimationFrame(() => {
      pv.measure();
      pv.goTo(current, { instant: true });
      setCurrent(current);
    });
    hint.textContent = mobile() ? 'Swipe to turn · tap to zoom' : '← → to turn · click to zoom';
    return;
  }

  show(lepView);
  history.replaceState(null, '', `#${next}`);
  if (next === 'folded') {
    unfoldBtn.textContent = 'Unfold';
    lep.fold(instant || prev !== 'unfolded');
    hint.textContent = mobile() ? 'Tap to unfold' : 'Click to unfold';
    return;
  }
  // unfolded
  const fromStack = prev === 'folded' && !instant;
  requestAnimationFrame(() => {
    lep.measure();
    lep.unfold(!fromStack);
    if (!fromStack) lep.scrollToIndex(current);
  });
  unfoldBtn.textContent = 'Fold';
  hint.textContent = mobile() ? 'Swipe the strip · tap a page to zoom' : 'Scroll or drag · click a page to zoom';
}

$$('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
unfoldBtn.addEventListener('click', () => setMode(mode === 'unfolded' ? 'folded' : 'unfolded'));

// --- Keyboard ---------------------------------------------------------------
addEventListener('keydown', (e) => {
  if (zoom.isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea, select')) return;
  if (mode === 'pages') {
    const map = { ArrowRight: () => pv.next(), ArrowLeft: () => pv.prev(), Home: () => pv.goTo(0), End: () => pv.goTo(pages.length - 1) };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
    else if ((e.key === 'Enter' || e.key === ' ') && e.target === document.body) { e.preventDefault(); zoom.open(current); }
  } else if (mode === 'unfolded') {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (d) { e.preventDefault(); lep.scrollToIndex(Math.max(0, Math.min(pages.length - 1, current + d)), !reducedMotion()); }
    else if (e.key === 'Enter' && e.target === document.body) zoom.open(current);
  }
});

// --- Settings ----------------------------------------------------------------
const settingsBtn = $('.settings-btn');
const settingsPanel = $('#settings-panel');
settingsBtn.addEventListener('click', () => {
  const open = settingsPanel.hidden;
  settingsPanel.hidden = !open;
  settingsBtn.setAttribute('aria-expanded', open);
});
document.addEventListener('click', (e) => {
  if (!settingsPanel.hidden && !e.target.closest('.settings')) {
    settingsPanel.hidden = true;
    settingsBtn.setAttribute('aria-expanded', 'false');
  }
});

const zigzag = $('#opt-zigzag');
zigzag.checked = prefs.get('zigzag', false);
lep.setZigzag(zigzag.checked, true);
zigzag.addEventListener('change', () => {
  prefs.set('zigzag', zigzag.checked);
  lep.setZigzag(zigzag.checked);
});

const vector = $('#opt-vector');
if (!pdfUrl) {
  vector.disabled = true;
  vector.parentElement.title = 'Add DmitriiDemidovA05.pdf to /pages to enable';
} else {
  vector.checked = prefs.get('vector', false);
  vector.addEventListener('change', async () => {
    prefs.set('vector', vector.checked);
    if (!vector.checked) return clearVector();
    const { pageCount } = await import('./pdf.js');
    const n = await pageCount(pdfUrl).catch(() => 0);
    if (n !== pages.length) {
      vector.checked = false;
      hint.textContent = `PDF has ${n} pages, images have ${pages.length} — vector mode disabled.`;
      return;
    }
    scheduleVector();
  });
}

// --- Download -----------------------------------------------------------------
const download = $('[data-download]');
if (pdfUrl) download.href = pdfUrl;
else download.hidden = true;

// --- Start ----------------------------------------------------------------------
function fromHash() {
  const h = location.hash.slice(1);
  const m = h.match(/^page-(\d+)$/);
  if (m) {
    current = Math.min(pages.length, Math.max(1, +m[1])) - 1;
    return 'pages';
  }
  if (h === 'unfolded' || h === 'folded') return h;
  return mobile() ? 'pages' : 'folded';
}
setMode(fromHash(), { instant: true });
addEventListener('hashchange', () => setMode(fromHash()));
