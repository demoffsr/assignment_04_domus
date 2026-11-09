// Optional vector rendering through PDF.js. Loaded only when the setting is on.
const docs = new Map(); // url → document promise, one per book
const MAX_PIXELS = 16e6; // stay under mobile canvas limits

/**
 * Safari has no canvas `filter`, and PDF.js uses it to turn a luminosity soft mask (the glows and
 * fades Figma exports) into transparency; without it those layers come out solid black.
 * This does the same conversion by hand for the one draw call that needs it.
 */
function polyfillLuminosityMask() {
  const proto = CanvasRenderingContext2D.prototype;
  if ('filter' in proto) return;
  const draw = proto.drawImage;
  proto.drawImage = function (image, ...rest) {
    const luminosity = rest.length === 8 && this.globalCompositeOperation === 'destination-in'
      && typeof this.filter === 'string' && this.filter.includes('luminosity');
    if (!luminosity) return draw.call(this, image, ...rest);
    this.filter = 'none'; // a plain property here, so it would otherwise outlive ctx.restore()
    const [sx, sy, sw, sh, ...dest] = rest;
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.round(sw));
    tmp.height = Math.max(1, Math.round(sh));
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    draw.call(tctx, image, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
    const px = tctx.getImageData(0, 0, tmp.width, tmp.height);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i + 3] = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = 0;
    }
    tctx.putImageData(px, 0, 0);
    draw.call(this, tmp, 0, 0, tmp.width, tmp.height, ...dest);
    tmp.width = tmp.height = 0;
  };
}

let pdfjsReady = null;
function ensurePdfjs() {
  pdfjsReady ||= (async () => {
    polyfillLuminosityMask();
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return pdfjsReady;
}

async function load(url) {
  if (!docs.has(url)) docs.set(url, ensurePdfjs().then((pdfjs) => pdfjs.getDocument({ url }).promise));
  return docs.get(url);
}

// --- Local files (the upload page) ---------------------------------------------

/** Opens a PDF the person picked on their own computer. */
export async function openPdfFile(file) {
  const pdfjs = await ensurePdfjs();
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

/** Size of page `index` (0-based) in PDF points. */
export async function pageSize(doc, index) {
  const { width, height } = (await doc.getPage(index + 1)).getViewport({ scale: 1 });
  return { width, height };
}

/** Renders page `index` onto a white canvas exactly `widthPx` pixels wide. */
export async function renderPageTo(doc, index, widthPx) {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: widthPx / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function pageCount(url) {
  return (await load(url)).numPages;
}

const pending = new Map();

/** Render page `index` (0-based) to a canvas `cssWidth` px wide at device resolution. */
export async function renderPage(url, index, cssWidth) {
  const doc = await load(url);
  if (index >= doc.numPages) return null;
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  let scale = (cssWidth * devicePixelRatio) / base.width;
  const area = base.width * base.height * scale * scale;
  if (area > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / area);
  const viewport = page.getViewport({ scale });

  const key = `${url}#${index}`;
  pending.get(key)?.cancel();
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport });
  pending.set(key, task);
  try {
    await task.promise;
  } catch {
    return null; // cancelled by a newer render
  } finally {
    if (pending.get(key) === task) pending.delete(key);
  }
  return canvas;
}
