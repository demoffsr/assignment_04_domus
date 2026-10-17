import { ASPECT, hydrate, setSizes } from './images.js';
import { createPanel, chain, chainFolds, ease, clamp, tween } from './panel.js';

const NEIGHBOUR = (68 * Math.PI) / 180; // how far the side panels are folded back

/**
 * Page-by-page view. The focused page lies flat; its neighbours are folded
 * back into depth like the next panels of a folding screen. Turning a page
 * moves the fold from one hinge to the next, so the next panel swings flat
 * while the current one folds away. Focus `f` is continuous, which lets
 * drags and swipes scrub the fold directly.
 */
export function createPageView(root, pages, { reducedMotion, onChange, onOpen }) {
  const scene = document.createElement('div');
  scene.className = 'pv-scene';
  root.append(scene);
  const panels = pages.map((p) => {
    const panel = createPanel(p);
    scene.append(panel.el);
    return panel;
  });

  let f = 0; // continuous focus position
  let target = 0;
  let w = 0, h = 0;
  let cancel = null;
  let reported = -1;
  let started = false; // don't report a page until the app has asked for one

  function measure() {
    const r = root.getBoundingClientRect();
    h = Math.min(r.height, (r.width * (innerWidth < 700 ? 0.84 : 0.62)) / ASPECT);
    w = h * ASPECT;
    root.style.setProperty('--pw', `${w}px`);
    root.style.setProperty('--ph', `${h}px`);
    root.style.perspective = `${Math.round(w * 3.4)}px`;
    panels.forEach((p) => setSizes(p.pic, w));
    render();
  }

  function render() {
    const k0 = Math.max(0, Math.floor(f) - 2);
    const k1 = Math.min(pages.length - 1, Math.ceil(f) + 2);
    const thetas = [];
    for (let i = k0; i <= k1; i++) {
      const d = i - f;
      thetas.push(Math.sign(d) * NEIGHBOUR * Math.min(1, Math.abs(d)));
    }
    const { points } = chain(thetas, w);
    const folds = chainFolds(thetas);
    // Point on the chain that should sit at the centre of the stage.
    const arc = f + 0.5 - k0;
    const j = clamp(Math.floor(arc), 0, thetas.length - 1);
    const u = (arc - j) * w;
    const cx = points[j].x + u * Math.cos(thetas[j]);
    const cz = points[j].z - u * Math.sin(thetas[j]);

    panels.forEach((p, i) => {
      if (i < k0 || i > k1) return p.pose(0, 0, 0, 0, undefined, 0);
      const t = thetas[i - k0];
      const d = Math.abs(i - f);
      const opacity = clamp(2 - d, 0, 1);
      p.pose(points[i - k0].x - cx, points[i - k0].z - cz, t, t, folds[i - k0], opacity);
    });

    const idx = Math.round(f);
    for (let i = idx - 2; i <= idx + 2; i++) panels[i] && hydrate(panels[i].pic, i === idx ? 'high' : 'low');
    if (started && idx !== reported) {
      reported = idx;
      onChange(idx);
    }
  }

  function goTo(i, { instant = false, duration } = {}) {
    started = true;
    target = clamp(i, 0, pages.length - 1);
    cancel && cancel();
    if (instant) {
      f = target;
      return render();
    }
    if (reducedMotion()) {
      // Simple fade instead of the fold.
      scene.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }).onfinish = () => {
        f = target;
        render();
        scene.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'forwards' });
      };
      return;
    }
    const from = f;
    const dist = Math.abs(target - from);
    if (dist < 0.001) return render();
    const d = duration ?? Math.min(1100, 520 + 160 * Math.sqrt(dist));
    cancel = tween(d, (t) => {
      f = from + (target - from) * ease.inOut(t);
      render();
    }, () => (cancel = null));
  }

  // --- Drag / swipe scrubs the fold directly ------------------------------
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    cancel && cancel();
    drag = { x: e.clientX, f0: f, t: performance.now(), v: 0, lastX: e.clientX, moved: false, id: e.pointerId };
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 6) {
      drag.moved = true;
      root.setPointerCapture(e.pointerId);
      root.classList.add('dragging');
    }
    if (!drag.moved) return;
    const now = performance.now();
    drag.v = (e.clientX - drag.lastX) / Math.max(1, now - drag.t);
    drag.lastX = e.clientX;
    drag.t = now;
    f = clamp(drag.f0 - dx / (w * 0.9), -0.25, pages.length - 0.75);
    if (reducedMotion()) return;
    render();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    root.classList.remove('dragging');
    if (!d.moved) {
      // Plain click/tap: open zoom on the focused page, or go to a neighbour.
      const el = e.target.closest('.panel');
      if (!el) return;
      const i = +el.dataset.index;
      return i === Math.round(f) ? onOpen(i) : goTo(i);
    }
    const dx = e.clientX - d.x;
    let next = Math.round(f - clamp(d.v * 0.35, -0.6, 0.6));
    if (Math.abs(dx) > 40 && next === Math.round(d.f0)) next += dx < 0 ? 1 : -1;
    goTo(clamp(next, Math.round(d.f0) - 1, Math.round(d.f0) + 1), { duration: 480 });
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  new ResizeObserver(measure).observe(root);

  return {
    goTo,
    next: () => goTo(target + 1),
    prev: () => goTo(target - 1),
    get index() { return Math.round(target); },
    get count() { return pages.length; },
    get width() { return w; },
    focusPanel: () => panels[Math.round(f)],
    measure,
  };
}
