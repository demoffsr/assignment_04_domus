import { createPicture, hydrate } from './images.js';
import { createPageView } from './pageview.js';
import { createLeporello } from './leporello.js';
import { createZoom } from './zoom.js';

const FOLD_AWAY_MS = 900; // closing the strip on the way back to the library

/**
 * One book of the library: its leporello (folded / unfolded), its page-by-page
 * view and its zoom. The leporello is built straight away because the library
 * shows every book folded; the page-by-page view and zoom are built the first
 * time they are needed.
 *
 * ctx: { stage, bookTpl, zoomTpl, reducedMotion, mobile, vectorChecked,
 *        setHint, onMode, replaceHash }
 */
export function createBook(data, ctx) {
  const { id, pages, pdfUrl } = data;

  const el = ctx.bookTpl.content.firstElementChild.cloneNode(true);
  el.dataset.book = id;
  ctx.stage.append(el);

  const $ = (s) => el.querySelector(s);
  const $$ = (s) => [...el.querySelectorAll(s)];
  const lepView = $('.view-lep');
  const pagesView = $('.view-pages');
  const unfoldBtn = $('[data-unfold]');

  let mode = null;
  let current = 0; // page index shared by all modes
  let vectorOk = null; // null = not checked yet, false = PDF page count differs from the images

  const vectorOn = () => ctx.vectorChecked() && !!pdfUrl && vectorOk !== false;

  // --- Zoom (built on first use) ---------------------------------------------
  let zoom = null;
  function getZoom() {
    if (zoom) return zoom;
    const zoomEl = ctx.zoomTpl.content.firstElementChild.cloneNode(true);
    document.body.append(zoomEl);
    zoom = createZoom(zoomEl, pages, {
      vector: vectorOn,
      renderVector: (i, w) => import('./pdf.js').then((m) => m.renderPage(pdfUrl, i, w)),
      onNavigate: (d) => {
        const i = Math.min(pages.length - 1, Math.max(0, zoom.index + d));
        zoom.show(i);
        setCurrent(i);
        if (mode === 'pages') pv.goTo(i, { instant: true });
      },
    });
    return zoom;
  }

  // --- Leporello ---------------------------------------------------------------
  const lep = createLeporello($('[data-lep]'), pages, {
    reducedMotion: ctx.reducedMotion,
    onOpen: (i) => getZoom().open(i),
    onIndex: (i) => setCurrent(i),
  });
  lep.onUnfoldRequest(() => setMode('unfolded'));
  lep.fold(true); // shows the cover and starts loading it

  // --- Page by page: view, counter, arrows, thumbnails (built on first use) ---
  const counter = $('[data-counter]');
  const sectionLabel = $('[data-section]');
  const thumbs = $('[data-thumbs]');
  let pv = null;
  let thumbButtons = [];

  function ensurePages() {
    if (pv) return;
    pv = createPageView($('[data-pv]'), pages, {
      reducedMotion: ctx.reducedMotion,
      onOpen: (i) => getZoom().open(i),
      onChange: (i) => setCurrent(i),
    });

    thumbButtons = pages.map((page, i) => {
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

    $('[data-prev]').addEventListener('click', () => pv.prev());
    $('[data-next]').addEventListener('click', () => pv.next());
  }

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
      thumbs.scrollTo({ left: b.offsetLeft - thumbs.clientWidth / 2 + b.offsetWidth / 2, behavior: ctx.reducedMotion() ? 'auto' : 'smooth' });
      $('[data-prev]').disabled = i === 0;
      $('[data-next]').disabled = i === pages.length - 1;
      ctx.replaceHash(`${id}/page-${i + 1}`);
      scheduleVector();
    }
  }

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

  /** Check once that the PDF has as many pages as the images; resolves to whether vector mode may be used. */
  async function verifyVector() {
    if (!pdfUrl) return false;
    if (vectorOk === null) {
      const { pageCount } = await import('./pdf.js');
      const n = await pageCount(pdfUrl).catch(() => 0);
      vectorOk = n === pages.length;
      if (!vectorOk) ctx.setHint(`PDF has ${n} pages, images have ${pages.length} — vector mode disabled.`);
    }
    if (vectorOk) scheduleVector();
    return vectorOk;
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
  show(lepView);

  /**
   * `silent` = leave the address bar and the header alone (used when leaving for the library).
   * `fold` = { duration, done } passed on when closing the strip.
   */
  function setMode(next, { instant = false, silent = false, fold } = {}) {
    if (next === mode) return;
    const prev = mode;
    mode = next;
    if (!silent) ctx.onMode(next);
    const hint = (t) => !silent && ctx.setHint(t);

    if (next === 'pages') {
      ensurePages();
      show(pagesView);
      clearVector();
      requestAnimationFrame(() => {
        pv.measure();
        pv.goTo(current, { instant: true });
        setCurrent(current);
      });
      hint(ctx.mobile() ? 'Swipe to turn · tap to zoom' : '← → to turn · click to zoom');
      return;
    }

    show(lepView);
    if (!silent) ctx.replaceHash(`${id}/${next}`);
    if (next === 'folded') {
      unfoldBtn.textContent = 'Unfold';
      lep.fold(instant || prev !== 'unfolded', fold);
      hint(ctx.mobile() ? 'Tap to unfold' : 'Click to unfold');
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
    hint(ctx.mobile() ? 'Swipe the strip · tap a page to zoom' : 'Scroll or drag · click a page to zoom');
  }

  unfoldBtn.addEventListener('click', () => setMode(mode === 'unfolded' ? 'folded' : 'unfolded'));

  /**
   * Quickly closes an open strip before the library takes over. Resolves once
   * the stack is closed (other modes have nothing to fold, so it resolves at once).
   */
  function foldAway() {
    clearTimeout(vecTimer);
    if (mode !== 'unfolded') return Promise.resolve();
    return new Promise((resolve) => {
      const safety = setTimeout(resolve, 3000); // a newer animation may cancel this one
      setMode('folded', { silent: true, fold: { duration: FOLD_AWAY_MS, done: () => (clearTimeout(safety), resolve()) } });
    });
  }

  /** Back to the closed stack without touching the URL — the library takes over. */
  function close() {
    clearTimeout(vecTimer);
    if (mode) setMode('folded', { silent: true });
    mode = null;
  }

  // --- Keyboard ---------------------------------------------------------------
  function handleKey(e) {
    if (mode === 'pages') {
      const map = { ArrowRight: () => pv.next(), ArrowLeft: () => pv.prev(), Home: () => pv.goTo(0), End: () => pv.goTo(pages.length - 1) };
      if (map[e.key]) { e.preventDefault(); map[e.key](); }
      else if ((e.key === 'Enter' || e.key === ' ') && e.target === document.body) { e.preventDefault(); getZoom().open(current); }
    } else if (mode === 'unfolded') {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (d) { e.preventDefault(); lep.scrollToIndex(Math.max(0, Math.min(pages.length - 1, current + d)), !ctx.reducedMotion()); }
      else if (e.key === 'Enter' && e.target === document.body) getZoom().open(current);
    }
  }

  return {
    id,
    data,
    el,
    lep,
    setMode,
    close,
    foldAway,
    handleKey,
    verifyVector,
    clearVector,
    scheduleVector,
    vectorOn,
    /** Jump to page `i` (0-based); in page-by-page mode the view follows. */
    goTo(i) {
      current = Math.min(pages.length - 1, Math.max(0, i));
      if (mode === 'pages' && pv) pv.goTo(current, { instant: true });
    },
    get mode() { return mode; },
    get current() { return current; },
    get zoomOpen() { return !!zoom?.isOpen; },
  };
}
