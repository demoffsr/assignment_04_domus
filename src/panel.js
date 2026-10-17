import { createPicture } from './images.js';

const LIGHT = (-28 * Math.PI) / 180; // light comes from front-left

// Shadow amount for a face turned `yaw` radians. A page lying flat gets 0;
// faces turned away from the light darken, faces turned towards it stay clean.
function shadeFor(yaw) {
  const v = (Math.cos(LIGHT) - Math.cos(yaw - LIGHT)) * 1.15;
  return Math.min(0.82, Math.max(0, v));
}

/**
 * One sheet of the leporello: front face (the page), back face (bare paper),
 * a flat shade layer driven by the panel's angle to the light, and ridge / valley
 * lines on both edges that make the folds read on any page colour.
 */
export function createPanel(page, { sizes } = {}) {
  const el = document.createElement('div');
  el.className = 'panel';
  el.dataset.index = page.index;

  const front = document.createElement('div');
  front.className = 'face front';
  const pic = createPicture(page, { sizes });
  const shade = document.createElement('i');
  shade.className = 'shade';
  // Fold lines on both edges: a light ridge line (fold pointing at the viewer)
  // and a shadowed valley (fold pointing away). Light lines keep seams visible
  // on black pages, where a shadow alone would disappear.
  const edges = ['l', 'r'].map((side) => {
    const edge = document.createElement('i');
    edge.className = `edge ${side}`;
    const valley = document.createElement('i');
    valley.className = 'valley';
    const ridge = document.createElement('i');
    ridge.className = 'ridge';
    edge.append(valley, ridge);
    front.append(edge);
    return { valley, ridge, v: -1, r: -1 };
  });
  front.prepend(pic);
  front.append(shade);

  const [r, g, b] = [page.paper.r, page.paper.g, page.paper.b];
  front.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;

  const back = document.createElement('div');
  back.className = 'face back';
  back.style.backgroundColor = `rgb(${r * 0.92 | 0}, ${g * 0.92 | 0}, ${b * 0.92 | 0})`;
  const backShade = document.createElement('i');
  backShade.className = 'shade';
  back.append(backShade);

  // Contact shadow: a plane lying on the floor under the panel's bottom edge.
  // It lives in the panel's 3D space, so it follows every fold.
  const cast = document.createElement('i');
  cast.className = 'cast';

  el.append(cast, front, back);

  let last = '';
  let castOpacity = 1;
  return {
    el,
    pic,
    page,
    /** Floor-shadow strength 0…1 (hidden while sheets are stacked, to avoid z-fighting). */
    setCast(o) {
      if (Math.abs(o - castOpacity) < 0.004) return;
      castOpacity = o;
      cast.style.opacity = o.toFixed(3);
      cast.style.visibility = o <= 0 ? 'hidden' : '';
    },
    /**
     * x, z: position of the panel's left edge. theta: its own rotation (rad).
     * yaw: rotation in world space (theta + any parent rotation) for lighting.
     * folds: [left, right] crease strength, −1…1. Positive = ridge, negative = valley.
     */
    pose(x, z, theta, yaw = theta, folds = NO_FOLDS, opacity = 1) {
      const t = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${theta.toFixed(5)}rad)`;
      if (t !== last) {
        el.style.transform = t;
        last = t;
      }
      shade.style.opacity = shadeFor(yaw).toFixed(3);
      backShade.style.opacity = shadeFor(yaw + Math.PI).toFixed(3);
      for (let k = 0; k < 2; k++) {
        const e = edges[k];
        const r = Math.max(0, folds[k]), v = Math.max(0, -folds[k]);
        if (Math.abs(r - e.r) > 0.004) e.ridge.style.opacity = (e.r = r).toFixed(3);
        if (Math.abs(v - e.v) > 0.004) e.valley.style.opacity = (e.v = v).toFixed(3);
      }
      el.style.opacity = opacity < 1 ? opacity.toFixed(3) : '';
      el.style.visibility = opacity <= 0 ? 'hidden' : '';
    },
  };
}

const NO_FOLDS = [0, 0];

/**
 * Crease strength for the hinge between two panels with rotations a → b.
 * Turning further away (b > a) makes a ridge, back towards the viewer a valley.
 * `memory` keeps a faint crease visible when the paper lies flat.
 * Returns a signed value: + ridge, − valley.
 */
export function hinge(a, b, memorySign = 1) {
  const d = b - a;
  const sign = Math.abs(d) > 1e-4 ? Math.sign(d) : memorySign;
  return sign * Math.min(1, 0.5 + Math.abs(d) * 1.1);
}

/** Left/right crease values for every panel of a chain. */
export function chainFolds(thetas, memory = (i) => 1) {
  const n = thetas.length;
  const out = thetas.map(() => [0, 0]);
  for (let i = 0; i < n - 1; i++) {
    const h = hinge(thetas[i], thetas[i + 1], memory(i));
    out[i][1] = h;
    out[i + 1][0] = h;
  }
  return out;
}

/**
 * Lay panels out as a hinged chain: each panel starts where the previous one
 * ends. Returns the left-edge position of every panel plus the total length.
 */
export function chain(thetas, w, gap = 0) {
  const out = new Array(thetas.length);
  let x = 0, z = 0;
  for (let i = 0; i < thetas.length; i++) {
    out[i] = { x, z };
    x += w * Math.cos(thetas[i]) + gap;
    z -= w * Math.sin(thetas[i]);
  }
  return { points: out, end: { x, z } };
}

export const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  // Gentle sine-based in/out, used for the long unfold.
  sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** requestAnimationFrame tween. Returns a cancel function. */
export function tween(duration, onFrame, onDone) {
  const start = performance.now();
  let raf = requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - start) / duration);
    onFrame(t);
    if (t < 1) raf = requestAnimationFrame(step);
    else onDone && onDone();
  });
  return () => cancelAnimationFrame(raf);
}
