import { clamp } from './panel.js';

/**
 * Full-screen zoom. Shows the already-loaded image instantly, then swaps in
 * the full-resolution original. Pan by dragging, pinch / ctrl-wheel / wheel
 * to zoom, double-click to toggle. Max zoom = 1 image pixel per device pixel
 * (never upscaled); with vector mode on, PDF.js re-renders sharp beyond that.
 */
export function createZoom(root, pages, { vector, renderVector, onNavigate }) {
  const canvas = root.querySelector('[data-zoom-canvas]');
  const label = root.querySelector('[data-zoom-label]');
  const frame = document.createElement('div');
  frame.className = 'zoom-frame';
  canvas.append(frame);

  let index = -1;
  let s = 1, x = 0, y = 0; // scale relative to "fit", translation in px
  let fitW = 0, fitH = 0;
  let returnFocus = null;
  let vecTimer = 0;
  const pointers = new Map();
  let gesture = null;

  const maxScale = () => {
    const page = pages[index];
    const pixel = page.width / (fitW * devicePixelRatio);
    return vector() ? Math.max(4, pixel) : Math.max(1, pixel);
  };

  function layout() {
    const page = pages[index];
    const vw = canvas.clientWidth, vh = canvas.clientHeight;
    const r = page.width / page.height;
    fitH = Math.min(vh - 32, (vw - 32) / r);
    fitW = fitH * r;
    frame.style.width = `${fitW}px`;
    frame.style.height = `${fitH}px`;
    apply();
  }

  function bounds() {
    const vw = canvas.clientWidth, vh = canvas.clientHeight;
    const bx = Math.max(0, (fitW * s - vw) / 2 + 16);
    const by = Math.max(0, (fitH * s - vh) / 2 + 16);
    x = clamp(x, -bx, bx);
    y = clamp(y, -by, by);
  }

  function apply() {
    bounds();
    frame.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
    label.textContent = `${pages[index].title} · ${Math.round((s * fitW * devicePixelRatio / pages[index].width) * 100)}%`;
    root.classList.toggle('zoomed', s > 1.01);
    clearTimeout(vecTimer);
    if (vector()) vecTimer = setTimeout(sharpen, 180);
  }

  async function sharpen() {
    const i = index;
    const c = await renderVector(i, fitW * s);
    if (!c || i !== index) return;
    c.className = 'zoom-vector';
    frame.querySelector('.zoom-vector')?.remove();
    frame.append(c);
  }

  // Zoom keeping the point (cx, cy) — in canvas coords from centre — still.
  function zoomAt(next, cx = 0, cy = 0) {
    next = clamp(next, 1, maxScale());
    const k = next / s;
    x = cx - (cx - x) * k;
    y = cy - (cy - y) * k;
    s = next;
    apply();
  }

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2];
  };

  function show(i) {
    index = clamp(i, 0, pages.length - 1);
    const page = pages[index];
    s = 1; x = 0; y = 0;
    frame.innerHTML = '';
    frame.style.backgroundColor = `rgb(${page.paper.r}, ${page.paper.g}, ${page.paper.b})`;
    // 1) the best image the page already has → instant
    const visible = document.querySelector(`.panel[data-index="${index}"] img.loaded`);
    if (visible?.currentSrc) {
      const pre = new Image();
      pre.src = visible.currentSrc;
      pre.alt = '';
      pre.className = 'zoom-preview';
      frame.append(pre);
    }
    // 2) the full-resolution original
    const img = new Image();
    img.alt = page.alt;
    img.decoding = 'async';
    img.className = 'zoom-full';
    img.draggable = false;
    img.onload = () => img.classList.add('loaded');
    img.src = page.original;
    frame.append(img);
    layout();
  }

  function open(i) {
    returnFocus = document.activeElement;
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('visible'));
    document.body.classList.add('no-scroll');
    show(i);
    root.querySelector('[data-zoom-close]').focus();
  }

  function close() {
    root.classList.remove('visible');
    document.body.classList.remove('no-scroll');
    setTimeout(() => (root.hidden = true), 220);
    returnFocus?.focus?.();
  }

  // --- Input -----------------------------------------------------------
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [cx, cy] = local(e);
    if (e.ctrlKey || !(s > 1)) zoomAt(s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), cx, cy);
    else { x -= e.deltaX; y -= e.deltaY; apply(); }
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    const [cx, cy] = local(e);
    zoomAt(s > 1.01 ? 1 : maxScale(), cx, cy);
  });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    frame.classList.add('moving');
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, x, y };
    } else if (pointers.size === 1) {
      gesture = { px: e.clientX, py: e.clientY, x, y, moved: false, t: performance.now() };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2 && gesture?.d) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const next = clamp(gesture.s * (d / gesture.d), 1, maxScale());
      const k = next / gesture.s;
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      s = next;
      x = cx - (gesture.cx - gesture.x) * k;
      y = cy - (gesture.cy - gesture.y) * k;
      apply();
    } else if (pointers.size === 1 && gesture && 'px' in gesture) {
      const dx = e.clientX - gesture.px, dy = e.clientY - gesture.py;
      if (Math.abs(dx) + Math.abs(dy) > 4) gesture.moved = true;
      if (s > 1.01) { x = gesture.x + dx; y = gesture.y + dy; apply(); }
    }
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      frame.classList.remove('moving');
      // Swipe left/right at fit size changes page.
      if (gesture && 'px' in gesture && s <= 1.01 && gesture.moved) {
        const dx = e.clientX - gesture.px;
        if (Math.abs(dx) > 60) onNavigate(dx < 0 ? 1 : -1);
      }
      gesture = null;
    } else gesture = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  root.querySelector('[data-zoom-in]').addEventListener('click', () => zoomAt(s * 1.6));
  root.querySelector('[data-zoom-out]').addEventListener('click', () => zoomAt(s / 1.6));
  root.querySelector('[data-zoom-close]').addEventListener('click', close);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === '+' || e.key === '=') zoomAt(s * 1.6);
    else if (e.key === '-') zoomAt(s / 1.6);
    else if (e.key === 'ArrowRight' && s <= 1.01) onNavigate(1);
    else if (e.key === 'ArrowLeft' && s <= 1.01) onNavigate(-1);
    else if (e.key === 'Tab') {
      // keep focus inside the dialog
      const f = [...root.querySelectorAll('button')];
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
    } else return;
    e.stopPropagation();
  });
  addEventListener('resize', () => !root.hidden && layout());

  return {
    open,
    close,
    show,
    get isOpen() { return !root.hidden; },
    get index() { return index; },
  };
}
