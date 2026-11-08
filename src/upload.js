// The "Add a leporello" page. Everything up to Publish happens in the browser:
// a PDF is read, A4-landscape sheets are cut into A5 pages,
// the person previews the result, and only then are the pages encoded and sent.
import { auth } from './auth.js';
import { openPdfFile, pageSize, renderPageTo } from './pdf.js';

const ASPECT = 148 / 210; // A5 portrait, the shape every page is shown in
const PANEL_W = 1680; // widest variant, as in the existing books
const PANEL_H = Math.round(PANEL_W / ASPECT);
const WIDTHS = [420, 840, 1680];
const THUMB_H = 340;
const MAX_PAGES = 120;
const MAX_PDF = 80 * 1024 * 1024; // keep in step with the Worker

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const pad = (n) => String(n).padStart(2, '0');
const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
/** Drops a canvas's pixel memory now; Safari otherwise holds on to it and slows down under memory pressure. */
const release = (canvas) => { if (canvas) canvas.width = canvas.height = 0; };

/** How many A5 pages sit side by side on a sheet of this shape (A4 landscape = 2). */
function pagesPerSheet(w, h) {
  const r = w / h;
  if (r < 1.2) return 1;
  return Math.min(3, Math.max(2, Math.round(r / ASPECT)));
}

/** Average colour of a 2 px frame around the canvas: the paper colour, as the image build computes it. */
function edgeColour(source, sx = 0, sy = 0, sw = source.width, sh = source.height) {
  const S = 48;
  const c = canvasOf(S, S);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (x > 1 && x < S - 2 && y > 1 && y < S - 2) continue;
      const i = (y * S + x) * 4;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

let webpOk;
/**
 * WebP where the browser can encode it. Safari cannot, so it gets JPEG: pages are opaque, and a
 * lossless PNG of a full page is several times heavier to send. PNG is the last resort.
 */
async function encode(canvas) {
  if (webpOk === undefined) webpOk = (await toBlob(canvasOf(2, 2), 'image/webp', 0.9))?.type === 'image/webp';
  if (webpOk) return { blob: await toBlob(canvas, 'image/webp', 0.9), ext: 'webp' };
  const jpg = await toBlob(canvas, 'image/jpeg', 0.92);
  if (jpg?.type === 'image/jpeg') return { blob: jpg, ext: 'jpg' };
  return { blob: await toBlob(canvas, 'image/png'), ext: 'png' };
}

async function hash8(blob) {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(d)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MESSAGES = {
  bad_title: 'Give the book a title.',
  too_large: 'A file is too large for the server.',
  not_signed_in: 'Your session expired. Please sign in again.',
  network: 'Cannot reach the server. Check your connection and press Publish again.',
};

export function createUploader(page, { onPublished, onDone, onClose, onHome }) {
  const $ = (s) => page.querySelector(s);
  const dropzone = $('[data-dropzone]');
  const input = $('[data-file-input]');
  const status = $('[data-upload-status]');
  const preview = $('[data-upload-preview]');
  const options = $('[data-upload-options]');
  const perSelect = $('[data-opt-per]');
  const swapBox = $('[data-opt-swap]');
  const summary = $('[data-upload-summary]');
  const grid = $('[data-upload-grid]');
  const form = $('#upload-form');
  const errorEl = $('[data-upload-error]');
  const submit = $('[data-upload-submit]');
  const closeBtn = $('[data-upload-close]');

  // The four screens of the page: the form, publishing, done, failed.
  const views = {
    edit: $('[data-upload-edit]'),
    progress: $('[data-upload-progress]'),
    done: $('[data-upload-done]'),
    failed: $('[data-upload-failed]'),
  };
  const pg = {
    step: $('[data-progress-step]'),
    title: $('[data-progress-title]'),
    bar: $('[data-progress-bar]'),
    fill: $('[data-progress-fill]'),
    count: $('[data-progress-count]'),
    percent: $('[data-progress-percent]'),
    eta: $('[data-progress-eta]'),
    thumb: $('[data-progress-thumb]'),
    now: $('[data-progress-now]'),
    sent: $('[data-progress-sent]'),
    steps: [...page.querySelectorAll('[data-step]')],
    cancelRow: $('[data-cancel-row]'),
    confirmRow: $('[data-cancel-confirm-row]'),
  };
  function showView(name) {
    for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
    page.dataset.view = name;
    if (name === 'edit') views.edit.scrollIntoView?.({ block: 'start' });
  }

  let source = null; // { doc, file }
  let sheets = []; // [{ w, h, thumb }]
  let panels = []; // [{ sheet, part, n, excluded }]
  let draftId = null;
  let busy = false;
  let abort = null; // AbortController of the upload in progress
  let cancelled = false;

  const say = (text) => (status.textContent = text);
  const fail = (text) => (errorEl.textContent = text);

  function reset() {
    source?.doc?.destroy?.();
    source = null;
    sheets = [];
    panels = [];
    draftId = null;
    form.reset();
    grid.replaceChildren();
    showPreview(false);
    dropzone.hidden = false;
    say('');
    fail('');
    input.value = '';
    cancelled = false;
    abort = null;
    showView('edit');
    setBusy(false);
  }

  /** The preview (pages, details, Publish) replaces the dropzone; the page switches to its wide layout. */
  function showPreview(on) {
    preview.hidden = !on;
    submit.hidden = !on;
    page.classList.toggle('has-preview', on);
  }

  function setBusy(on) {
    busy = on;
    submit.disabled = on;
    closeBtn.disabled = on;
    perSelect.disabled = swapBox.disabled = on;
    page.classList.toggle('is-busy', on);
  }

  // --- Reading the files ------------------------------------------------------
  async function load(fileList) {
    const pdfs = [...fileList].filter(isPdf);
    if (!pdfs.length) return say('Only PDF files can be added.');
    if (pdfs.length > 1 || fileList.length > pdfs.length) return say('Add one PDF at a time.');
    const pdf = pdfs[0];
    fail('');
    dropzone.hidden = true;
    showPreview(false);

    try {
      sheets = [];
      say('Opening the PDF…');
      const doc = await openPdfFile(pdf);
      if (doc.numPages > MAX_PAGES) throw new Error(`The PDF has ${doc.numPages} pages; up to ${MAX_PAGES} are allowed.`);
      source = { doc, file: pdf };
      for (let i = 0; i < doc.numPages; i++) {
        say(`Reading pages… ${i + 1}/${doc.numPages}`);
        const { width, height } = await pageSize(doc, i);
        sheets.push({ w: width, h: height, thumb: await renderPageTo(doc, i, THUMB_H * (width / height)) });
      }
    } catch (err) {
      console.error(err);
      reset();
      return say(err.message?.startsWith('The PDF') ? err.message : 'Could not read that file. Is it a valid PDF?');
    }

    // Guess the layout from the first sheet; the person can change it below.
    const guess = pagesPerSheet(sheets[0].w, sheets[0].h);
    perSelect.value = String(guess);
    swapBox.checked = false;
    options.hidden = !sheets.some((s) => s.w / s.h > 1.2);
    const name = pdf.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    if (!form.elements.title.value) form.elements.title.value = name;
    say('');
    showPreview(true);
    rebuild();
  }

  // --- Preview ------------------------------------------------------------------
  function rebuild() {
    const per = +perSelect.value;
    panels = [];
    sheets.forEach((s, si) => {
      const n = s.w / s.h > 1.2 ? per : 1;
      for (let k = 0; k < n; k++) panels.push({ sheet: si, part: swapBox.checked ? n - 1 - k : k, n, excluded: false });
    });
    if (panels.length > MAX_PAGES) {
      fail(`That makes ${panels.length} pages; up to ${MAX_PAGES} are allowed.`);
    } else fail('');
    renderGrid();
  }

  function renderGrid() {
    grid.replaceChildren();
    panels.forEach((p, i) => {
      const s = sheets[p.sheet];
      const w = s.thumb.width / p.n;
      const c = canvasOf(w, s.thumb.height);
      c.getContext('2d').drawImage(s.thumb, p.part * w, 0, w, s.thumb.height, 0, 0, c.width, c.height);
      const b = document.createElement('div');
      b.className = 'thumb-page';
      b.append(c);
      const num = document.createElement('span');
      b.append(num);
      p.el = b;
      p.num = num;
      grid.append(b);
    });
    updateNumbers();
    updateFades();
  }

  function updateNumbers() {
    let n = 0;
    for (const p of panels) p.num.textContent = p.excluded ? '×' : ++n;
    const out = panels.length - n;
    const sheetNote = panels.length !== sheets.length ? `${sheets.length} sheets → ` : '';
    summary.textContent = `${sheetNote}${n} page${n === 1 ? '' : 's'}${out ? ` · ${out} left out` : ''}`;
  }

  // The strip of pages scrolls sideways; a mouse wheel scrolls it too.
  grid.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    grid.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  /** Fades the edges of the strip that have more pages beyond them, a little more the further it is scrolled. */
  const FADE = 56;
  function updateFades() {
    const left = Math.max(0, Math.min(FADE, grid.scrollLeft));
    const right = Math.max(0, Math.min(FADE, grid.scrollWidth - grid.clientWidth - grid.scrollLeft));
    grid.style.setProperty('--fade-l', `${left}px`);
    grid.style.setProperty('--fade-r', `${right}px`);
  }
  grid.addEventListener('scroll', updateFades, { passive: true });
  new ResizeObserver(updateFades).observe(grid);

  perSelect.addEventListener('change', rebuild);
  swapBox.addEventListener('change', rebuild);

  // --- Choosing files ---------------------------------------------------------------
  input.addEventListener('change', () => input.files.length && load(input.files));

  // A file can be dropped anywhere on the page, not only on the dropzone. The browser's own
  // reaction to a stray drop (opening the PDF in this tab) is always cancelled.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const canDrop = () => !busy && !dropzone.hidden && page.dataset.view === 'edit';
  let dragDepth = 0; // dragenter/dragleave also fire for every child element passed over
  const endDrag = () => {
    dragDepth = 0;
    page.classList.remove('is-dragging');
  };
  page.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    if (canDrop()) page.classList.add('is-dragging');
  });
  page.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canDrop() ? 'copy' : 'none';
  });
  page.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) endDrag();
  });
  page.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    endDrag();
    if (canDrop() && e.dataTransfer.files.length) load(e.dataTransfer.files);
  });

  // --- Publishing ----------------------------------------------------------------------
  /** Draws one page (a crop of a sheet) onto an A5 canvas; odd shapes are fitted, not stretched. */
  function compose(src, sx, sw, sh) {
    const c = canvasOf(PANEL_W, PANEL_H);
    const ctx = c.getContext('2d', { alpha: false });
    ctx.imageSmoothingQuality = 'high';
    if (Math.abs(sw / sh / ASPECT - 1) < 0.03) {
      ctx.drawImage(src, sx, 0, sw, sh, 0, 0, PANEL_W, PANEL_H);
    } else {
      const k = Math.min(PANEL_W / sw, PANEL_H / sh);
      const col = edgeColour(src, sx, 0, sw, sh);
      ctx.fillStyle = `rgb(${col.r},${col.g},${col.b})`;
      ctx.fillRect(0, 0, PANEL_W, PANEL_H);
      ctx.drawImage(src, sx, 0, sw, sh, (PANEL_W - sw * k) / 2, (PANEL_H - sh * k) / 2, sw * k, sh * k);
    }
    return c;
  }

  let cachedSheet = { index: -1, canvas: null };
  async function sheetCanvas(si, n) {
    if (cachedSheet.index === si) return cachedSheet.canvas;
    const canvas = await renderPageTo(source.doc, si, PANEL_W * n);
    release(cachedSheet.canvas); // the previous sheet is no longer needed
    cachedSheet = { index: si, canvas };
    return canvas;
  }

  /** Encodes a page at every width; returns [{ w, name, blob, ext }] and the paper colour. */
  async function prepare(canvas, number) {
    const out = [];
    const paper = edgeColour(canvas);
    for (const w of WIDTHS) {
      const c = w === PANEL_W ? canvas : canvasOf(w, Math.round(w / ASPECT));
      if (c !== canvas) {
        const ctx = c.getContext('2d', { alpha: false });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, c.width, c.height);
      }
      const { blob, ext } = await encode(c);
      release(c); // the page canvas itself is released by the caller, the smaller ones right here
      out.push({ w, ext, blob, name: `p${pad(number)}-${w}-${await hash8(blob)}.${ext}` });
    }
    return { files: out, paper };
  }

  async function put(id, name, blob, signal, tries = 3) {
    for (let i = 1; ; i++) {
      try {
        return await auth.call(`/upload/${id}/${encodeURIComponent(name)}`, { method: 'PUT', body: blob, signal });
      } catch (err) {
        if (err.name === 'AbortError' || i >= tries || err.status === 413 || err.status === 401) throw err;
        await new Promise((r) => setTimeout(r, 600 * i));
      }
    }
  }

  // --- The publishing screen ----------------------------------------------------------
  const size = (bytes) =>
    bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${bytes / 1048576 >= 10 ? Math.round(bytes / 1048576) : (bytes / 1048576).toFixed(1)} MB`;
  function etaText(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    if (s < 8) return 'a few seconds left';
    if (s < 55) return `about ${Math.round(s / 5) * 5} s left`;
    return `about ${Math.max(1, Math.round(s / 60))} min left`;
  }

  /** Total work = pages + the PDF (if kept) + the final step; progress is how much of it is finished. */
  function createProgress(title, pages, withPdf) {
    const total = pages + (withPdf ? 1 : 0) + 1;
    const t0 = performance.now();
    let done = 0;
    let sent = 0;
    let speed = null; // MB/s of the page uploaded last
    pg.title.textContent = `Publishing “${title}”`;
    pg.cancelRow.hidden = false;
    pg.confirmRow.hidden = true;
    pg.steps.find((el) => el.dataset.step === 'pdf').hidden = !withPdf;

    const set = (step, label) => {
      pg.step.textContent = label;
      pg.steps.forEach((el) => {
        const order = ['pages', 'pdf', 'publish'];
        const mine = order.indexOf(el.dataset.step);
        const now = order.indexOf(step);
        el.dataset.state = mine < now ? 'done' : mine === now ? 'active' : 'todo';
      });
    };
    const render = () => {
      const p = Math.min(1, done / total);
      pg.fill.style.transform = `scaleX(${p})`;
      pg.percent.textContent = `${Math.round(p * 100)}%`;
      pg.bar.setAttribute('aria-valuenow', Math.round(p * 100));
      pg.sent.textContent = sent ? `${size(sent)} sent${speed ? ` · ${speed.toFixed(1)} MB/s` : ''}` : 'Nothing sent yet';
      const elapsed = performance.now() - t0;
      pg.eta.textContent = done >= 1 && done < total ? etaText((elapsed / done) * (total - done)) : done >= total ? 'Almost done' : 'Estimating…';
    };
    render();
    return {
      step: set,
      page(i, canvas) {
        pg.count.textContent = `Page ${i} of ${pages}`;
        pg.now.textContent = `Page ${i}`;
        if (canvas) pg.thumb.replaceChildren(canvas);
      },
      advance(bytes = 0, ms = 0) { done++; sent += bytes; if (ms > 50 && bytes > 20000) speed = bytes / 1048576 / (ms / 1000); render(); },
      text(count, now) { if (count) pg.count.textContent = count; if (now) pg.now.textContent = now; },
      get bytes() { return sent; },
    };
  }

  const cloneThumb = (panel) => {
    const src = panel.el?.querySelector('canvas');
    if (!src) return null;
    const c = canvasOf(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  };

  const stop = () => {
    if (cancelled) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  };

  async function publish() {
    fail('');
    const title = form.elements.title.value.trim();
    const chosen = panels.filter((p) => !p.excluded);
    if (!title) return fail(MESSAGES.bad_title);
    if (!chosen.length) return fail('Keep at least one page.');
    if (chosen.length > MAX_PAGES) return fail(`Up to ${MAX_PAGES} pages are allowed.`);

    const withPdf = source.file.size <= MAX_PDF;
    cancelled = false;
    abort = new AbortController();
    const { signal } = abort;
    const progress = createProgress(title, chosen.length, withPdf);
    showView('progress');
    setBusy(true);

    try {
      draftId ||= (await auth.call('/books', { method: 'POST', signal })).id;
      const id = draftId;
      const pages = [];
      const timings = []; // how long each page took to prepare and to send, for the console
      let pending = Promise.resolve();
      progress.step('pages', 'Preparing and uploading pages');

      // The PDF travels while the pages are still being prepared, instead of as a lone wait at the end.
      let pdfUpload = null;
      if (withPdf) {
        pdfUpload = put(id, 'book.pdf', source.file, signal).then(() => progress.advance(source.file.size));
        pdfUpload.catch(() => {}); // surfaced where it is awaited below
      }

      for (let i = 0; i < chosen.length; i++) {
        stop();
        const p = chosen[i];
        progress.page(i + 1, cloneThumb(p));
        const canvas = await sheetCanvas(p.sheet, p.n);
        stop();
        const sw = canvas.width / p.n;
        const tPrep = performance.now();
        const composed = compose(canvas, p.part * sw, sw, canvas.height);
        const { files, paper } = await prepare(composed, i + 1);
        release(composed);
        const prepMs = Math.round(performance.now() - tPrep);
        await pending; // the previous page finishes uploading while this one was being prepared
        stop();
        const bytes = files.reduce((n, f) => n + f.blob.size, 0);
        const tUp = performance.now();
        const uploading = Promise.all(files.map((f) => put(id, f.name, f.blob, signal))).then(() => {
          const upMs = Math.round(performance.now() - tUp);
          timings.push({ page: i + 1, prepMs, upMs, KB: Math.round(bytes / 1024), 'MB/s': +(bytes / 1048576 / (upMs / 1000)).toFixed(2) });
          progress.advance(bytes, upMs);
        });
        uploading.catch(() => {}); // a cancel rejects it; the loop sees the cancel on its own
        pending = uploading;

        const list = files.map((f) => ({ w: f.w, src: `u/${id}/${f.name}` }));
        const same = files[0].ext === 'webp';
        pages.push({
          width: PANEL_W,
          height: PANEL_H,
          // WebP where the browser could make it. Otherwise the files are JPEG (or PNG); they sit in the
          // list the plain <img> uses, which takes any format.
          variants: { avif: [], webp: same ? list : [], png: list },
          original: list[list.length - 1].src,
          paper,
          title: i === 0 ? 'Cover' : `Page ${i + 1}`,
          section: '',
          alt: '',
        });
      }
      await pending;
      stop();

      let pdfKey = null;
      if (withPdf) {
        progress.step('pdf', 'Saving the PDF');
        progress.text('Saving the PDF', 'The original PDF');
        pg.thumb.replaceChildren();
        await pdfUpload;
        pdfKey = `u/${id}/book.pdf`;
      }
      stop();

      progress.step('publish', 'Publishing');
      progress.text('Publishing…', 'Adding it to the library');
      pg.cancelRow.hidden = true; // from here on the book may already be live, so there is nothing safe to cancel
      await auth.call(`/books/${id}/publish`, {
        method: 'POST',
        body: { title, meta: form.elements.meta.value, credit: form.elements.credit.value, pdf: pdfKey, pages },
      });
      progress.advance();
      console.info('[tubus] upload timings per page'); console.table(timings);

      const summaryText = `“${title}” is in the library: ${pages.length} page${pages.length === 1 ? '' : 's'}, ${size(progress.bytes)}.`;
      cachedSheet = { index: -1, canvas: null };
      setBusy(false);
      $('[data-done-title]').textContent = 'Published';
      $('[data-done-text]').textContent = summaryText;
      showView('done');
      await onPublished(id);
    } catch (err) {
      if (err.name === 'AbortError') return; // cancelled: cancelUpload() tidies up
      console.error(err);
      $('[data-failed-text]').textContent = MESSAGES[err.code] || 'Something went wrong while publishing. Your pages are kept, so trying again is quick.';
      setBusy(false);
      showView('failed');
    }
  }

  /** Stops the upload, drops the unfinished draft and leaves the page. */
  async function cancelUpload() {
    cancelled = true;
    abort?.abort();
    const id = draftId;
    draftId = null;
    reset();
    onClose();
    if (id) auth.call(`/books/${id}`, { method: 'DELETE' }).catch(() => {}); // best effort; an unpublished draft is never shown anyway
  }

  $('[data-progress-cancel]').addEventListener('click', () => {
    pg.cancelRow.hidden = true;
    pg.confirmRow.hidden = false;
  });
  $('[data-cancel-keep]').addEventListener('click', () => {
    pg.confirmRow.hidden = true;
    pg.cancelRow.hidden = false;
  });
  $('[data-cancel-confirm]').addEventListener('click', cancelUpload);
  $('[data-failed-retry]').addEventListener('click', () => !busy && publish());
  $('[data-failed-cancel]').addEventListener('click', cancelUpload);
  $('[data-done-view]').addEventListener('click', () => onDone());
  $('[data-done-another]').addEventListener('click', reset);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!busy) publish();
  });
  closeBtn.addEventListener('click', () => !busy && onClose());
  // The wordmark takes the person back to the library, except while a publish is running or has failed.
  $('[data-upload-home]').addEventListener('click', () => {
    if (!busy && page.dataset.view !== 'failed') onHome();
  });

  return {
    reset,
    get busy() { return busy; },
  };
}
