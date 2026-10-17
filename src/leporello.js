import { ASPECT, hydrate, setSizes } from './images.js';
import { createPanel, chain, chainFolds, ease, lerp, clamp, tween } from './panel.js';

const DEG = Math.PI / 180;
const CLOSED = 90 * DEG; // fold angle of the closed stack (sheets parallel)
const ZIGZAG = 13 * DEG; // resting fold angle when "keep slight zigzag" is on
const PAPER = 1.6; // px of thickness per sheet in the closed stack
const FOLDED_SCALE = 1; // size of the closed stack relative to the open strip

/**
 * Folded + unfolded views share one 3D scene driven by `p`:
 *   p = 0 → closed stack, cover facing the viewer, camera slightly turned
 *   p = 1 → open strip (flat, or a gentle zigzag)
 * Panels alternate their fold direction like a real folding screen. The whole
 * chain is rotated by `psi` so the cover stays facing the viewer while the
 * rest unfurls from behind it.
 */
export function createLeporello(root, pages, { reducedMotion, onOpen, onIndex }) {
  root.innerHTML = '';
  const track = document.createElement('div'); // gives the scroller its width
  track.className = 'lep-track';
  const snaps = pages.map(() => {
    const s = document.createElement('span');
    track.append(s);
    return s;
  });
  // Pool of light on the "studio floor" the booklet stands on. Lives outside
  // the scroller so it stays put while the strip scrolls.
  const floor = document.createElement('div');
  floor.className = 'lep-floor';
  root.parentElement.querySelector('.lep-floor')?.remove();
  root.parentElement.prepend(floor);
  const cam = document.createElement('div');
  cam.className = 'lep-cam';
  root.append(track, cam);

  // cam = camera (placement, tilt); group = the chain's own rotation.
  const group = document.createElement('div');
  group.className = 'lep-group';
  cam.append(group);
  const panels = pages.map((p) => {
    const panel = createPanel(p);
    group.append(panel.el);
    return panel;
  });

  // Soft shadow lying on the floor under the closed stack. It sits in the
  // stack's own 3D space, so it follows the camera tilt and stays under it.
  const ambient = document.createElement('i');
  ambient.className = 'lep-ambient';
  group.append(ambient);

  let p = 0;
  let zig = 0; // resting fold angle at p = 1
  let w = 0, h = 0, vw = 0, vh = 0, pad = 0;
  let cancel = null;
  let io = null;
  let lastPersp = 0;

  function measure() {
    vw = root.clientWidth;
    vh = root.clientHeight;
    h = Math.min(vh * 0.8, (vw * (vw < 700 ? 0.78 : 0.4)) / ASPECT);
    w = h * ASPECT;
    pad = Math.max(16, Math.min(vw * 0.08, (vw - w) / 2));
    root.style.setProperty('--pw', `${w}px`);
    root.style.setProperty('--ph', `${h}px`);
    panels.forEach((pn) => setSizes(pn.pic, w));
    floor.style.top = `${root.offsetTop + (vh + h) / 2}px`;
    placeShadow();
    render();
  }

  function placeShadow() {
    const thetas = pages.map((_, i) => (i % 2 === 0 ? -CLOSED : CLOSED));
    const { points } = chain(thetas, w, PAPER);
    const depth = points[points.length - 1].x + 1;
    const m = w * 0.3;
    ambient.style.width = `${depth + m * 2}px`;
    ambient.style.height = `${w + m * 2}px`;
    ambient.style.transform = `translate3d(${-m}px, ${h + 0.5}px, ${-m}px) rotateX(90deg)`;
  }

  function render() {
    const e = ease.sine(p);
    const phi = lerp(CLOSED, zig, e);
    const psi = lerp(CLOSED, 0, e);
    // Camera: a quiet three-quarter view of the closed stack that settles to front-on.
    const settle = ease.inOut(clamp(p * 1.6, 0, 1));
    const tiltY = lerp(-24, 0, settle) * DEG;
    const tiltX = lerp(-12, 0, settle) * DEG;

    const thetas = pages.map((_, i) => (i % 2 === 0 ? -phi : phi));
    const { points, end } = chain(thetas, w, PAPER * Math.sin(phi));

    // Horizontal placement: centred stack → strip starting at the left padding.
    const centre = (vw - w) / 2;
    const offX = lerp(centre, pad, ease.inOut(clamp(p * 1.25, 0, 1)));
    // Camera pivot: the middle of the block's footprint on the floor, so the
    // booklet keeps standing on the floor while the camera settles.
    const pz = (-points[points.length - 1].x / 2) * (1 - e);
    const scale = lerp(FOLDED_SCALE, 1, settle);
    // A more distant camera while folded keeps the stack undistorted.
    const persp = Math.round(Math.max(1600, w * lerp(9, 6, settle)));
    if (persp !== lastPersp) root.style.perspective = `${(lastPersp = persp)}px`;
    cam.style.transform =
      `translate3d(${offX.toFixed(2)}px, ${((vh - h) / 2).toFixed(2)}px, 0) ` +
      `translate3d(${w / 2}px, ${h}px, ${pz.toFixed(2)}px) scale3d(${scale}, ${scale}, ${scale}) ` +
      `rotateX(${tiltX}rad) rotateY(${tiltY}rad) ` +
      `translate3d(${-w / 2}px, ${-h}px, ${(-pz).toFixed(2)}px)`;
    group.style.transform = `rotateY(${psi}rad)`;

    // Flat strip keeps the memory of the zigzag: even hinges ridge, odd ones valley.
    const folds = chainFolds(thetas, (i) => (i % 2 === 0 ? 1 : -1));
    // Per-sheet floor shadows appear once the sheets have separated.
    const cast = clamp((p - 0.06) * 5, 0, 1);
    panels.forEach((pn, i) => {
      pn.pose(points[i].x, points[i].z, thetas[i], thetas[i] + psi + tiltY, folds[i]);
      pn.setCast(cast);
    });


    // Floor shadow of the closed stack fades as the sheets separate.
    const a = 1 - ease.inOut(clamp(p * 1.8, 0, 1));
    ambient.style.opacity = a.toFixed(3);
    ambient.style.visibility = a <= 0 ? 'hidden' : '';

    // Scroll width for the open strip.
    const step = w * Math.cos(zig);
    const length = p >= 1 ? pad * 2 + end.x : vw;
    track.style.width = `${Math.ceil(length)}px`;
    snaps.forEach((s, i) => {
      s.style.width = `${step}px`;
      s.style.marginLeft = i === 0 ? `${pad}px` : '';
    });
  }

  // Lazy-load: only images that come near the viewport are fetched.
  function watch() {
    if (io) return;
    io = new IntersectionObserver((entries) => {
      entries.forEach((en) => en.isIntersecting && hydrate(panels[+en.target.dataset.index].pic));
    }, { root, rootMargin: '0px 60% 0px 60%' });
    panels.forEach((pn) => io.observe(pn.el));
  }

  function animateTo(to, duration, done) {
    cancel && cancel();
    root.classList.add('animating');
    const from = p;
    if (reducedMotion()) {
      cam.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).onfinish = () => {
        p = to;
        render();
        cam.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'forwards' });
        root.classList.remove('animating');
        done && done();
      };
      return;
    }
    cancel = tween(duration * Math.abs(to - from), (t) => {
      p = lerp(from, to, t);
      render();
    }, () => {
      cancel = null;
      root.classList.remove('animating');
      done && done();
    });
  }

  function unfold(instant) {
    [0, 1, 2, 3].forEach((i) => hydrate(panels[i].pic, i === 0 ? 'high' : undefined));
    root.classList.add('open');
    if (instant) {
      p = 1;
      render();
      watch();
      return;
    }
    watch();
    animateTo(1, 2600);
  }

  function fold(instant) {
    hydrate(panels[0].pic, 'high');
    const s = root.scrollLeft;
    root.classList.remove('open');
    if (instant || s === 0) {
      root.scrollLeft = 0;
      if (instant) {
        p = 0;
        return render();
      }
      return animateTo(0, 2000);
    }
    // Glide back to the cover first, then close.
    root.scrollTo({ left: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    const wait = () => (root.scrollLeft < 2 ? animateTo(0, 2000) : requestAnimationFrame(wait));
    requestAnimationFrame(wait);
  }

  function setZigzag(on, instant) {
    const from = zig;
    const to = on ? ZIGZAG : 0;
    if (instant || p < 1 || reducedMotion()) {
      zig = to;
      return render();
    }
    tween(700, (t) => {
      zig = lerp(from, to, ease.inOut(t));
      render();
    });
  }

  function scrollToIndex(i, smooth) {
    root.scrollTo({ left: i * w * Math.cos(zig), behavior: smooth ? 'smooth' : 'auto' });
  }

  // --- Interaction in the open strip --------------------------------------
  root.addEventListener('wheel', (e) => {
    if (p < 1 || e.ctrlKey) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      root.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  root.addEventListener('scroll', () => {
    if (p >= 1) onIndex(clamp(Math.round(root.scrollLeft / (w * Math.cos(zig))), 0, pages.length - 1));
  }, { passive: true });

  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, s: root.scrollLeft, moved: false, id: e.pointerId, mouse: e.pointerType === 'mouse' };
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 5) {
      drag.moved = true;
      if (drag.mouse && p >= 1) {
        root.setPointerCapture(e.pointerId);
        root.classList.add('dragging');
      }
    }
    if (!drag.moved) return;
    // Touch uses native scrolling; mouse drag scrolls manually.
    if (drag.mouse && p >= 1) root.scrollLeft = drag.s - dx;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    root.classList.remove('dragging');
    if (d.moved) return;
    if (p === 0) return unfoldRequest();
    const el = e.target.closest('.panel');
    if (el && p >= 1) onOpen(+el.dataset.index);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', () => (drag = null));

  let unfoldRequest = () => {};
  new ResizeObserver(measure).observe(root);

  return {
    unfold,
    fold,
    setZigzag,
    scrollToIndex,
    onUnfoldRequest(fn) { unfoldRequest = fn; },
    get open() { return p >= 1; },
    get step() { return w * Math.cos(zig); },
    measure,
  };
}
