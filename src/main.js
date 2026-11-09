import './styles.css';
import { books, libraryError, fetchBooks, createPicture, hydrate } from './images.js';
import { createBook } from './book.js';
import { auth } from './auth.js';
import { createUploader } from './upload.js';
import { createLibrary } from './materials.js';
import { zip } from './zip.js';
import { inviteLink, renderQr } from './invite.js';
import { startAmbient } from './ambient.js';

startAmbient();

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

// --- Selecting several books (to download or delete them together) ------------------------
const selected = new Set(); // entries
let lastPicked = null; // for Shift-click ranges

// A soft checkmark: rounded ends, drawn in as the book gets selected.
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.8 12.6l3.7 3.6 6.9-7.6" pathLength="1"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

function makeCard(entry) {
  const { data } = entry;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <button type="button" class="card-check" aria-pressed="false">${CHECK}</button>
    <button type="button" class="card-open"><span class="cover"></span></button>
    <div class="card-foot">
      <button type="button" class="card-label" tabindex="-1"><strong></strong><span class="lib-author"></span><span class="dim"></span></button>
      <button type="button" class="card-dots" aria-haspopup="menu" aria-expanded="false" hidden>${DOTS}</button>
    </div>`;
  const first = data.pages[0];
  if (first) {
    const { r, g, b } = first.paper || {};
    $('.cover', card).style.background = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
    $('.cover', card).append(createPicture(first, { sizes: '(max-width: 700px) 46vw, 260px' }));
  }
  // With something selected, a click picks a book instead of opening it.
  const open = (e) => (selected.size ? toggleSelect(entry, e) : navigate(`${entry.id}/folded`));
  $('.card-open', card).addEventListener('click', open);
  $('.card-label', card).addEventListener('click', open);
  $('.card-check', card).addEventListener('click', (e) => toggleSelect(entry, e));
  $('.card-dots', card).addEventListener('click', () => toggleCardMenu(entry));
  // Build the 3D book while the pointer is on its way to the click.
  const warm = () => idle(() => ensureBook(entry));
  card.addEventListener('pointerenter', warm, { once: true });
  card.addEventListener('focusin', warm, { once: true });
  grid.append(card);
  coverIO.observe(card);
  return card;
}

/** Writes a book's current title, author and project line onto its card. */
function fillCard(entry) {
  const { data, card } = entry;
  $('strong', card).textContent = data.title;
  $('.lib-author', card).textContent = data.author || '';
  $('.dim', card).textContent = data.meta || '';
  $('.card-label', card).title = [data.title, data.author, data.meta].filter(Boolean).join('\n');
  $('.card-open', card).setAttribute('aria-label', `Open ${data.title}`);
  $('.card-check', card).setAttribute('aria-label', `Select ${data.title}`);
  $('.card-dots', card).setAttribute('aria-label', `More about ${data.title}`);
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
  fillCard(entry);
  updateDots(entry);
  entries.push(entry);
  return entry;
}
books.forEach(addEntry);

function renderShelf() {
  entries.forEach((e) => (e.card.hidden = !isShown(e)));
  for (const e of [...selected]) if (e.card.hidden) setSelected(e, false); // selection only covers what is on screen
  renderSelection();
}

/** Takes a book off the page (deleted here or by someone else). */
function removeEntry(entry) {
  selected.delete(entry);
  const i = entries.indexOf(entry);
  if (i >= 0) entries.splice(i, 1);
  coverIO.unobserve(entry.card);
  entry.card.remove();
  if (entry.book && entry.book !== active) entry.book.destroy(); // an open one goes once the library is back
  renderSelection();
}

/** Brings the page in line with the library: new books appear, renamed ones update, deleted ones go. */
async function syncLibrary() {
  let fresh;
  try {
    fresh = await fetchBooks();
  } catch {
    return;
  }
  let changed = false;
  for (const data of fresh) {
    const entry = entries.find((e) => e.id === data.id);
    if (!entry) {
      addEntry(data);
      changed = true;
    } else if (['title', 'meta', 'author', 'authorSlug', 'credit'].some((k) => (entry.data[k] ?? null) !== (data[k] ?? null))) {
      applyBook(entry, data);
      changed = true;
    }
  }
  for (const entry of [...entries]) {
    if (fresh.some((d) => d.id === entry.id)) continue;
    removeEntry(entry);
    changed = true;
  }
  if (!changed) return;
  if (active && !entries.some((e) => e.book === active)) navigate(libraryHash()); // the open book was deleted
  refreshView();
}

/** Applies new details (title, project line, credit, author) to a book already on the page. */
function applyBook(entry, details) {
  Object.assign(entry.data, { title: details.title, meta: details.meta, credit: details.credit ?? null, author: details.author, authorSlug: details.authorSlug });
  fillCard(entry);
}

function refreshView() {
  renderShelf();
  renderPeople();
  renderChrome();
  refreshActions();
}

// --- Flying between the grid and the 3D book ---------------------------------------
// How long each step takes (ms). Lower = snappier.
const FLIGHT_MS = 440; // the cover between the grid and the face of the stack
const TURN_IN_MS = 560; // the stack turning into its resting view after it landed
const TURN_OUT_MS = 340; // ...and straight again before it flies back
const FLIGHT_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // quick start, soft landing

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
    { duration: ms, easing: FLIGHT_EASE, fill: 'forwards' },
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
    await glide(el, from, to, FLIGHT_MS);
    await coverSettled(book);
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('[tubus] fly in', err); // an abort means a newer route removed the flyer
  }
  book.el.classList.remove('hold');
  if (!flyers.delete(el)) return book.lep.setTilt(1);
  el.remove();
  await book.lep.tiltTo(1, TURN_IN_MS);
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
    await glide(el, from, to, FLIGHT_MS);
  } catch {}
  if (flyers.delete(el)) {
    el.remove();
    entry.card.classList.remove('lifted');
  }
}

// --- Short confirmations ("renamed", "deleted", …) ----------------------------------------
const toastEl = $('[data-toast]');
let toastTimer = 0;
function toast(text, kind = 'ok') {
  clearTimeout(toastTimer);
  toastEl.classList.remove('show');
  void toastEl.offsetWidth; // restart the transition if one is already showing
  $('.toast-text', toastEl).textContent = text;
  $('.toast-icon', toastEl).textContent = kind === 'ok' ? '✓' : '!';
  toastEl.classList.toggle('is-error', kind !== 'ok');
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), kind === 'ok' ? 3400 : 5000);
}

// --- Selecting several books: download as a ZIP, delete together -------------------------
const selbar = $('[data-selbar]');
const selDownload = $('[data-sel-download]');
const selDelete = $('[data-sel-delete]');
const selAll = $('[data-sel-all]');

function setSelected(entry, on) {
  if (on) selected.add(entry);
  else selected.delete(entry);
  entry.card.classList.toggle('selected', on);
  $('.card-check', entry.card).setAttribute('aria-pressed', on);
}

/** Click on a cover or its circle. Shift-click selects everything between this book and the last one picked. */
function toggleSelect(entry, event) {
  const shown = entries.filter((e) => !e.card.hidden);
  if (event?.shiftKey && lastPicked && shown.includes(lastPicked) && shown.includes(entry)) {
    const [a, b] = [shown.indexOf(lastPicked), shown.indexOf(entry)].sort((x, y) => x - y);
    const on = !selected.has(entry);
    shown.slice(a, b + 1).forEach((e) => setSelected(e, on));
  } else {
    setSelected(entry, !selected.has(entry));
  }
  lastPicked = entry;
  closeCardMenu();
  renderSelection();
}

function clearSelection() {
  for (const e of [...selected]) setSelected(e, false);
  lastPicked = null;
  renderSelection();
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The bar shows what can be done with the current selection: download the ones with a PDF, delete your own. */
function renderSelection() {
  const list = [...selected];
  const pdfs = list.filter((e) => e.data.pdfUrl);
  const mine = list.filter(canManage);
  document.body.classList.toggle('selecting', list.length > 0);
  selbar.hidden = list.length === 0;
  $('[data-sel-count]').textContent = `${list.length} selected`;
  selDownload.hidden = pdfs.length === 0;
  selDownload.textContent = pdfs.length > 1 ? `Download ${pdfs.length} as ZIP` : 'Download PDF';
  selDelete.hidden = mine.length === 0;
  selDelete.textContent = `Delete ${mine.length}`;
  const shown = entries.filter((e) => !e.card.hidden);
  selAll.hidden = shown.every((e) => selected.has(e));
}

selAll.addEventListener('click', () => {
  entries.filter((e) => !e.card.hidden).forEach((e) => setSelected(e, true));
  renderSelection();
});
$('[data-sel-clear]').addEventListener('click', clearSelection);

/** A file-system friendly name for a book's PDF. */
const fileName = (title) => `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'leporello'}.pdf`;

let bulkBusy = false;
function setBulkBusy(on, text) {
  bulkBusy = on;
  [selDownload, selDelete, selAll].forEach((b) => (b.disabled = on));
  if (text) $('[data-sel-count]').textContent = text;
  if (!on) renderSelection();
}

/** One PDF is saved as it is; several are packed into one ZIP (browsers often block a burst of separate downloads). */
async function downloadSelected() {
  const list = [...selected].filter((e) => e.data.pdfUrl);
  if (!list.length || bulkBusy) return;
  const skipped = selected.size - list.length;
  if (list.length === 1) {
    await downloadPdf(list[0].data);
    return toast(skipped ? `PDF saved; ${plural(skipped, 'book has', 'books have')} no PDF` : `“${list[0].data.title}” saved`);
  }
  setBulkBusy(true, 'Preparing ZIP…');
  const files = [];
  const used = new Set();
  let failed = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      $('[data-sel-count]').textContent = `Preparing ZIP… ${i + 1}/${list.length}`;
      try {
        const res = await fetch(list[i].data.pdfUrl);
        if (!res.ok) throw new Error(res.status);
        let name = fileName(list[i].data.title);
        for (let n = 2; used.has(name.toLowerCase()); n++) name = fileName(`${list[i].data.title} (${n})`);
        used.add(name.toLowerCase());
        files.push({ name, data: new Uint8Array(await res.arrayBuffer()) });
      } catch {
        failed++;
      }
    }
    if (!files.length) return toast('Could not download the PDFs. Try again.', 'error');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip(files));
    a.download = `tubus-${files.length}-leporellos.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    const notes = [skipped && `${skipped} without a PDF skipped`, failed && `${failed} failed`].filter(Boolean).join(', ');
    toast(`ZIP with ${plural(files.length, 'PDF', 'PDFs')} saved${notes ? ` (${notes})` : ''}`, failed ? 'error' : 'ok');
  } finally {
    setBulkBusy(false);
  }
}
selDownload.addEventListener('click', downloadSelected);

// --- Managing a book: rename · delete · download ---------------------------------------
function canManage(entry) {
  return !!auth.user && entry.data.authorSlug === auth.user.slug; // the server checks again
}

/** The dots on a card show only when there is something to do: manage it, or download its PDF. */
function updateDots(entry) {
  $('.card-dots', entry.card).hidden = !(canManage(entry) || entry.data.pdfUrl);
}
const cardMenu = $('[data-card-menu]');
const bookActions = $('[data-book-actions]');
let menuEntry = null;
let menuDots = null;

const openEntry = () => entries.find((e) => e.book === active); // the book on screen, if any

/** Shows only what this person may do with this book. */
function applyActions(root, entry) {
  const manage = !!entry && canManage(entry);
  const pdf = !!entry?.data.pdfUrl;
  $('[data-act="rename"]', root).hidden = !manage;
  $('[data-act="delete"]', root).hidden = !manage;
  $('[data-act="download"]', root).hidden = !pdf;
  return manage || pdf;
}

/** The dots on each card, and the actions in Settings, follow who is signed in. */
function refreshActions() {
  entries.forEach(updateDots);
  bookActions.hidden = !applyActions(bookActions, openEntry());
  if (menuEntry && !entries.includes(menuEntry)) closeCardMenu();
}

function closeCardMenu() {
  cardMenu.hidden = true;
  menuDots?.setAttribute('aria-expanded', 'false');
  menuEntry = menuDots = null;
}

function toggleCardMenu(entry) {
  const dots = $('.card-dots', entry.card);
  if (menuEntry === entry) return closeCardMenu();
  closeCardMenu();
  if (!applyActions(cardMenu, entry)) return;
  $('[data-act="select"]', cardMenu).textContent = selected.has(entry) ? 'Unselect' : 'Select';
  menuEntry = entry;
  menuDots = dots;
  dots.setAttribute('aria-expanded', 'true');
  cardMenu.hidden = false;
  const r = dots.getBoundingClientRect();
  const w = cardMenu.offsetWidth;
  const h = cardMenu.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w));
  const top = r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
  cardMenu.style.left = `${left}px`;
  cardMenu.style.top = `${top}px`;
  $('.menu-item:not([hidden])', cardMenu)?.focus();
}

/** Saves the PDF to disk (a plain link would only open it in the tab, the file lives on another address). */
async function downloadPdf(data) {
  if (!data.pdfUrl) return;
  try {
    const res = await fetch(data.pdfUrl);
    if (!res.ok) throw new Error(res.status);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = `${data.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'leporello'}.pdf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch {
    window.open(data.pdfUrl, '_blank', 'noopener');
  }
}

const renameDialog = $('#rename-dialog');
const renameForm = $('#rename-form');
const renameError = $('[data-rename-error]');
const deleteDialog = $('#delete-dialog');
const deleteError = $('[data-delete-error]');
let dialogEntry = null; // the book the rename dialog is about
let dialogEntries = []; // the books the delete dialog is about
let deleteFromBar = false; // the dialog was opened from the selection bar, so the selection ends with it

function act(entry, what) {
  if (!entry) return;
  closeCardMenu();
  closeSettings();
  dialogEntries = [entry];
  if (what === 'select') return toggleSelect(entry);
  if (what === 'download') return downloadPdf(entry.data);
  if (what === 'rename') {
    dialogEntry = entry;
    const f = renameForm.elements;
    f.title.value = entry.data.title;
    f.meta.value = entry.data.meta || '';
    f.credit.value = entry.data.credit || '';
    renameError.textContent = '';
    renameDialog.showModal();
    f.title.select();
  } else if (what === 'delete') {
    deleteFromBar = false;
    askDelete([entry]);
  }
}

/** Opens the delete confirmation for one or several books (only the ones this person owns are deleted). */
function askDelete(list) {
  dialogEntries = list;
  const titles = list.map((e) => `“${e.data.title}”`);
  $('#delete-title').textContent = list.length === 1 ? 'Delete this leporello?' : `Delete ${list.length} leporellos?`;
  $('[data-delete-text]').textContent = list.length === 1
    ? `${titles[0]} will disappear from the library for everyone.`
    : `${titles.slice(0, 3).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''} will disappear from the library for everyone.`;
  deleteError.textContent = '';
  deleteDialog.showModal();
}

$$('[data-act]', cardMenu).forEach((b) => b.addEventListener('click', () => act(menuEntry, b.dataset.act)));
$$('[data-act]', bookActions).forEach((b) => b.addEventListener('click', () => act(openEntry(), b.dataset.act)));
$$('[data-dialog-cancel]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
[renameDialog, deleteDialog, $('#invite-dialog'), $('#lib-item-dialog'), $('#lib-name-dialog')].forEach((d) => d.addEventListener('click', (e) => e.target === d && d.close())); // the backdrop
document.addEventListener('click', (e) => menuEntry && !e.target.closest('.card-menu, .card-dots') && closeCardMenu());
shelfEl.addEventListener('scroll', closeCardMenu, { passive: true });

const MANAGE_ERRORS = {
  bad_title: 'Give the book a title.',
  no_such_book: 'This book is no longer there.',
  not_signed_in: 'Your session expired. Please sign in again.',
  not_found: 'The server does not support this yet. Try again a little later.',
  network: 'Cannot reach the server. Try again.',
};

renameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = renameForm.elements;
  const entry = dialogEntry;
  if (!f.title.value.trim()) return (renameError.textContent = MANAGE_ERRORS.bad_title);
  $('[data-rename-submit]').disabled = true;
  try {
    const oldTitle = entry.data.title;
    const { book } = await auth.call(`/books/${entry.id}`, { method: 'PATCH', body: { title: f.title.value, meta: f.meta.value, credit: f.credit.value } });
    applyBook(entry, book);
    renameDialog.close();
    refreshView();
    toast(book.title !== oldTitle ? `Leporello renamed to “${book.title}”` : `Details of “${book.title}” updated`);
  } catch (err) {
    renameError.textContent = MANAGE_ERRORS[err.code] || 'Something went wrong. Try again.';
    if (err.code === 'no_such_book') syncLibrary();
  } finally {
    $('[data-rename-submit]').disabled = false;
  }
});

$('[data-delete-confirm]').addEventListener('click', async () => {
  const list = [...dialogEntries];
  const button = $('[data-delete-confirm]');
  button.disabled = true;
  deleteError.textContent = '';
  let done = 0;
  let failed = 0;
  let lastError = null;
  const openOne = list.find((e) => e.book && e.book === active);
  const queue = [...list];
  // A few at a time keeps it quick without flooding the server.
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      try {
        await auth.call(`/books/${entry.id}`, { method: 'DELETE' });
        done++;
        removeEntry(entry);
      } catch (err) {
        if (err.code === 'no_such_book') { done++; removeEntry(entry); } // already gone
        else { failed++; lastError = err; }
      }
    }
  }));
  button.disabled = false;
  if (failed && !done) {
    deleteError.textContent = MANAGE_ERRORS[lastError?.code] || 'Something went wrong. Try again.';
    return;
  }
  deleteDialog.close();
  const only = list.length === 1 ? list[0] : null;
  toast(only ? `Leporello “${only.data.title}” deleted` : `${plural(done, 'leporello', 'leporellos')} deleted${failed ? `, ${failed} could not be deleted` : ''}`, failed ? 'error' : 'ok');
  if (deleteFromBar) clearSelection(); // what is left selected was not deletable by this person
  if (openOne && !entries.includes(openOne)) navigate(libraryHash()); // the open book folds away, the library takes over
  refreshView();
  loadPeople(true);
  if (failed) syncLibrary();
});

$('[data-sel-delete]').addEventListener('click', () => {
  const mine = [...selected].filter(canManage);
  if (!mine.length || bulkBusy) return;
  deleteFromBar = true;
  askDelete(mine);
  const others = selected.size - mine.length;
  if (others) $('[data-delete-text]').textContent += others === 1 ? ' The other selected book is not yours and will stay.' : ` The other ${others} selected books are not yours and will stay.`;
});

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
  bookActions.hidden = !applyActions(bookActions, openEntry());

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
    <div class="filter-seg" role="group" aria-label="Study library">
      <button type="button" data-f="library">Library</button>
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
$('[data-f="library"]', peopleNav).addEventListener('click', () => navigate('library'));
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
  if (raw === 'library') return { library: true };
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
    await leaving.lep.tiltTo(0, TURN_OUT_MS); // turn it face-on, ready to become the flat cover again
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
  if (!entry) leaving.destroy(); // it was deleted while open
  else if (!reducedMotion()) flyOut(entry, from);
}

function openBook(route) {
  const { entry } = route;
  clearSelection();
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
  syncLibraryPage(route);
  if (route?.library) return;
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
  if (document.querySelector('dialog[open]')) return; // a dialog handles Escape itself
  if (e.key === 'Escape' && menuEntry) return closeCardMenu();
  if (e.key === 'Escape' && selected.size && !profileOpen() && !uploadOpen() && !libraryOpen()) return clearSelection();
  if (e.key === 'Escape' && menuIsOpen()) return closePeopleMenu();
  if (e.key === 'Escape' && profileOpen()) return closeProfile();
  if (e.key === 'Escape' && uploadOpen()) return uploader.busy || closeUpload();
  if (e.key === 'Escape' && libraryOpen()) return navigate('');
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
const libraryOpen = () => document.documentElement.classList.contains('library-open');
const overlayOpen = () => profileOpen() || uploadOpen() || libraryOpen();
let creating = false;

// An invite link (?invite=CODE) brings the code with it: it fills the form and hides the field.
// The code is taken out of the address bar right away.
let linkInvite = '';
{
  const url = new URL(location.href);
  if (url.searchParams.has('invite')) {
    linkInvite = (url.searchParams.get('invite') || '').trim();
    url.searchParams.delete('invite');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
}
const inviteLabel = authForm.elements.invite.closest('label');

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
  $$('[data-register-only]').forEach((el) => (el.hidden = !creating));
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
  if (user) linkInvite = ''; // a signed-in browser has used the link (or never needed it)
  if (!user && !wasOut) {
    // Just signed out: start from a clean form.
    authForm.reset();
    setAuthMode(false);
  }
  inviteLabel.hidden = !!linkInvite;
  if (linkInvite) authForm.elements.invite.value = linkInvite;
  if (!user) (linkInvite ? authForm.elements.username : authForm.elements.invite).focus({ preventScroll: true });
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

// --- Invite: a pop-up with a link and a QR code anyone signed in can hand out -------
const inviteDialog = $('#invite-dialog');
const inviteField = $('[data-invite-link]');
const inviteCopy = $('[data-invite-copy]');
const inviteError = $('[data-invite-error]');
let inviteUrl = '';
let inviteCopyTimer = 0;

$('[data-invite-open]').addEventListener('click', async () => {
  closeAccountMenu();
  inviteError.textContent = '';
  clearTimeout(inviteCopyTimer);
  inviteCopy.textContent = 'Copy';
  inviteCopy.classList.remove('is-copied');
  if (!inviteUrl) {
    try {
      inviteUrl = inviteLink(await auth.invite());
    } catch (err) {
      return toast(AUTH_ERRORS[err.code] || 'Could not get the invite. Try again.', 'error');
    }
    renderQr($('[data-invite-qr]'), inviteUrl);
    inviteField.value = inviteUrl;
  }
  inviteDialog.showModal();
});

inviteField.addEventListener('focus', () => inviteField.select());

inviteCopy.addEventListener('click', async () => {
  inviteError.textContent = '';
  try {
    await navigator.clipboard.writeText(inviteUrl);
  } catch {
    inviteField.select();
    inviteError.textContent = 'Could not copy automatically. The link is selected: copy it by hand.';
    return;
  }
  inviteCopy.textContent = 'Copied';
  inviteCopy.classList.add('is-copied');
  clearTimeout(inviteCopyTimer);
  inviteCopyTimer = setTimeout(() => {
    inviteCopy.textContent = 'Copy';
    inviteCopy.classList.remove('is-copied');
  }, 2000);
});

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
  onHome: () => {
    closeUpload();
    navigate(''); // the library, whatever shelf was open behind
  },
  // The page stays on its "Published" screen; the library is brought up to date behind it.
  onPublished: async () => {
    await syncLibrary();
    await loadPeople(true);
  },
  onDone: () => {
    closeUpload();
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

// --- The study library: a full page at #library --------------------------------------------
const libraryPage = $('[data-lib-page]');
const studyLibrary = createLibrary(libraryPage, { toast, onHome: () => navigate('') });

/** Shows the page while the address is #library (and someone is signed in); hides it otherwise. */
function syncLibraryPage(route = parseHash()) {
  const wanted = !!route?.library && !!auth.user;
  if (wanted === libraryOpen()) return;
  document.documentElement.classList.toggle('library-open', wanted);
  appShell.forEach((el) => (el.inert = !auth.user || overlayOpen()));
  if (wanted) {
    closePeopleMenu();
    closeAccountMenu();
    studyLibrary.open();
  }
  document.activeElement?.blur();
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
    const input = { invite: linkInvite || f.invite.value.trim(), username: f.username.value.trim() };
    if (creating) await auth.register({ ...input, displayName: f.displayName.value });
    else await auth.signIn(input);
    authForm.reset(); // a signed-in browser no longer needs the code on screen
  } catch (err) {
    authError.textContent = AUTH_ERRORS[err.code] || 'Something went wrong. Try again.';
    if (err.code === 'bad_invite' && linkInvite) {
      // The link is out of date (the code was changed): let the person type a code instead.
      linkInvite = '';
      inviteLabel.hidden = false;
      f.invite.value = '';
      authError.textContent = 'This invite link is out of date. Ask for a new one, or type the code.';
      f.invite.focus({ preventScroll: true });
    }
  } finally {
    authSubmit.disabled = false;
  }
});

setAuthMode(!!linkInvite); // a link is for newcomers
auth.onChange(renderAccount);
auth.onChange(() => {
  refreshActions();
  syncLibraryPage();
  if (auth.user) loadPeople(true);
  else {
    studyLibrary.clear();
    inviteUrl = ''; // the code is for members only
    inviteDialog.close();
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
