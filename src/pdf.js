// Optional vector rendering through PDF.js. Loaded only when the setting is on.
const docs = new Map(); // url → document promise, one per book
const MAX_PIXELS = 16e6; // stay under mobile canvas limits

async function load(url) {
  if (!docs.has(url)) {
    docs.set(url, (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs.getDocument({ url }).promise;
    })());
  }
  return docs.get(url);
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
