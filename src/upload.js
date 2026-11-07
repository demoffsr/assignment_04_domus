// The "Add a leporello" page. Everything up to Publish happens in the browser:
// a PDF (or page images) is read, A4-landscape sheets are cut into A5 pages,
// the person previews the result, and only then are the pages encoded and sent.
import { auth } from './auth.js';
import { openPdfFile, pageSize, renderPageTo } from './pdf.js';

const ASPECT = 148 / 210; // A5 portrait, the shape every page is shown in
const PANEL_W = 1680; // widest variant, as in the existing books
const PANEL_H = Math.round(PANEL_W / ASPECT);
const WIDTHS = [420, 840, 1680];
const THUMB_H = 280;
const MAX_PAGES = 120;
const MAX_PDF = 80 * 1024 * 1024; // keep in step with the Worker

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImage = (f) => /^image\/(png|jpeg|webp)$/.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);
const pad = (n) => String(n).padStart(2, '0');
const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

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
/** WebP where the browser can encode it (Safari cannot), lossless PNG otherwise. */
async function encode(canvas) {
  if (webpOk === undefined) webpOk = (await toBlob(canvasOf(2, 2), 'image/webp', 0.9))?.type === 'image/webp';
  if (webpOk) return { blob: await toBlob(canvas, 'image/webp', 0.9), ext: 'webp' };
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

export function createUploader(page, { onPublished, onClose }) {
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

  let source = null; // { kind: 'pdf', doc, file } | { kind: 'images', files }
  let sheets = []; // [{ w, h, thumb }]
  let panels = []; // [{ sheet, part, n, excluded }]
  let draftId = null;
  let busy = false;

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
    preview.hidden = true;
    dropzone.hidden = false;
    say('');
    fail('');
    input.value = '';
    setBusy(false);
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
    const files = [...fileList];
    const pdf = files.find(isPdf);
    const images = files.filter(isImage).sort((a, b) => natural.compare(a.name, b.name));
    if (!pdf && !images.length) return say('Choose a PDF, or page images (PNG, JPG).');
    fail('');
    dropzone.hidden = true;
    preview.hidden = true;

    try {
      sheets = [];
      if (pdf) {
        say('Opening the PDF…');
        const doc = await openPdfFile(pdf);
        if (doc.numPages > MAX_PAGES) throw new Error(`The PDF has ${doc.numPages} pages; up to ${MAX_PAGES} are allowed.`);
        source = { kind: 'pdf', doc, file: pdf };
        for (let i = 0; i < doc.numPages; i++) {
          say(`Reading pages… ${i + 1}/${doc.numPages}`);
          const { width, height } = await pageSize(doc, i);
          sheets.push({ w: width, h: height, thumb: await renderPageTo(doc, i, THUMB_H * (width / height)) });
        }
      } else {
        if (images.length > MAX_PAGES) throw new Error(`Up to ${MAX_PAGES} images are allowed.`);
        source = { kind: 'images', files: images };
        for (let i = 0; i < images.length; i++) {
          say(`Reading pages… ${i + 1}/${images.length}`);
          const bmp = await createImageBitmap(images[i]);
          const thumb = canvasOf(THUMB_H * (bmp.width / bmp.height), THUMB_H);
          thumb.getContext('2d').drawImage(bmp, 0, 0, thumb.width, thumb.height);
          sheets.push({ w: bmp.width, h: bmp.height, thumb });
          bmp.close?.();
        }
      }
    } catch (err) {
      console.error(err);
      reset();
      return say(err.message?.startsWith('The PDF') || err.message?.startsWith('Up to') ? err.message : 'Could not read that file. Is it a valid PDF or image?');
    }

    // Guess the layout from the first sheet; the person can change it below.
    const guess = pagesPerSheet(sheets[0].w, sheets[0].h);
    perSelect.value = String(guess);
    swapBox.checked = false;
    options.hidden = !sheets.some((s) => s.w / s.h > 1.2);
    const name = (pdf || images[0]).name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    if (!form.elements.title.value) form.elements.title.value = pdf ? name : '';
    say('');
    preview.hidden = false;
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
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb-page';
      b.setAttribute('aria-pressed', 'true');
      b.title = 'Click to leave this page out';
      b.append(c);
      const num = document.createElement('span');
      b.append(num);
      b.addEventListener('click', () => {
        p.excluded = !p.excluded;
        b.setAttribute('aria-pressed', !p.excluded);
        updateNumbers();
      });
      p.el = b;
      p.num = num;
      grid.append(b);
    });
    updateNumbers();
  }

  function updateNumbers() {
    let n = 0;
    for (const p of panels) p.num.textContent = p.excluded ? '×' : ++n;
    const out = panels.length - n;
    const sheetNote = panels.length !== sheets.length ? `${sheets.length} sheets → ` : '';
    summary.textContent = `${sheetNote}${n} page${n === 1 ? '' : 's'}${out ? ` · ${out} left out` : ''}`;
  }

  perSelect.addEventListener('change', rebuild);
  swapBox.addEventListener('change', rebuild);

  // --- Choosing files ---------------------------------------------------------------
  input.addEventListener('change', () => input.files.length && load(input.files));
  ['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e) => e.dataTransfer?.files.length && load(e.dataTransfer.files));

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
    let canvas;
    if (source.kind === 'pdf') canvas = await renderPageTo(source.doc, si, PANEL_W * n);
    else {
      const bmp = await createImageBitmap(source.files[si]);
      canvas = canvasOf(bmp.width, bmp.height);
      canvas.getContext('2d', { alpha: false }).drawImage(bmp, 0, 0);
      bmp.close?.();
    }
    cachedSheet = { index: si, canvas };
    return canvas;
  }

  /** Encodes a page at every width; returns [{ w, name, blob, ext }] and the paper colour. */
  async function prepare(canvas, number) {
    const out = [];
    for (const w of WIDTHS) {
      const c = w === PANEL_W ? canvas : canvasOf(w, Math.round(w / ASPECT));
      if (c !== canvas) {
        const ctx = c.getContext('2d', { alpha: false });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, c.width, c.height);
      }
      const { blob, ext } = await encode(c);
      out.push({ w, ext, blob, name: `p${pad(number)}-${w}-${await hash8(blob)}.${ext}` });
    }
    return { files: out, paper: edgeColour(canvas) };
  }

  async function put(id, name, blob, tries = 3) {
    for (let i = 1; ; i++) {
      try {
        return await auth.call(`/upload/${id}/${encodeURIComponent(name)}`, { method: 'PUT', body: blob });
      } catch (err) {
        if (i >= tries || err.status === 413 || err.status === 401) throw err;
        await new Promise((r) => setTimeout(r, 600 * i));
      }
    }
  }

  async function publish() {
    fail('');
    const title = form.elements.title.value.trim();
    const chosen = panels.filter((p) => !p.excluded);
    if (!title) return fail(MESSAGES.bad_title);
    if (!chosen.length) return fail('Keep at least one page.');
    if (chosen.length > MAX_PAGES) return fail(`Up to ${MAX_PAGES} pages are allowed.`);

    setBusy(true);
    try {
      draftId ||= (await auth.call('/books', { method: 'POST' })).id;
      const id = draftId;
      const pages = [];
      let pending = Promise.resolve();

      for (let i = 0; i < chosen.length; i++) {
        const p = chosen[i];
        say(`Preparing and uploading pages… ${i + 1}/${chosen.length}`);
        const canvas = await sheetCanvas(p.sheet, p.n);
        const sw = canvas.width / p.n;
        const { files, paper } = await prepare(compose(canvas, p.part * sw, sw, canvas.height), i + 1);
        await pending; // the previous page finishes uploading while this one was being prepared
        pending = Promise.all(files.map((f) => put(id, f.name, f.blob)));

        const list = files.map((f) => ({ w: f.w, src: `u/${id}/${f.name}` }));
        const widest = list[list.length - 1].src;
        const same = files[0].ext === 'webp';
        pages.push({
          width: PANEL_W,
          height: PANEL_H,
          // WebP where the browser could make it, PNG otherwise; the <img> fallback needs a list either way.
          variants: { avif: [], webp: same ? list : [], png: list },
          original: widest,
          paper,
          title: i === 0 ? 'Cover' : `Page ${i + 1}`,
          section: '',
          alt: '',
        });
      }
      await pending;

      let pdfKey = null;
      if (source.kind === 'pdf') {
        if (source.file.size <= MAX_PDF) {
          say('Saving the PDF…');
          await put(id, 'book.pdf', source.file);
          pdfKey = `u/${id}/book.pdf`;
        }
      }

      say('Publishing…');
      await auth.call(`/books/${id}/publish`, {
        method: 'POST',
        body: { title, meta: form.elements.meta.value, credit: form.elements.credit.value, pdf: pdfKey, pages },
      });
      cachedSheet = { index: -1, canvas: null };
      setBusy(false);
      reset();
      await onPublished(id);
    } catch (err) {
      console.error(err);
      say('');
      fail(MESSAGES[err.code] || 'Something went wrong while publishing. Press Publish to try again.');
      setBusy(false);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!busy) publish();
  });
  closeBtn.addEventListener('click', () => !busy && onClose());

  return {
    reset,
    get busy() { return busy; },
  };
}
