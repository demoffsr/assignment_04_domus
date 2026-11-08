// The glow behind the site: the graphite light with a blue and a pink glow drifting slowly over it.
// It is drawn by a small shader, not by CSS gradients, because a smooth dark gradient shows rings
// (8-bit banding) in a browser, and a shader can dither every pixel: the rings disappear and there is
// no visible grain. If WebGL is not available, the CSS version (the .ambient element) stays.

const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;

// 0 → 1 → 0 over two periods, eased at both ends (like an alternating ease-in-out animation)
float swing(float period) {
  float x = 1.0 - abs(mod(uTime / period, 2.0) - 1.0);
  return 0.5 - 0.5 * cos(3.14159265 * x);
}

// a glow that fades smoothly to nothing at its edge (no visible rim)
vec3 glow(vec3 base, vec2 p, vec2 centre, vec2 radii, vec3 colour, float alpha) {
  float d = length((p - centre) / radii);
  float a = alpha * pow(max(1.0 - d * d, 0.0), 2.0);
  return mix(base, colour, a);
}

float ign(vec2 v) { return fract(52.9829189 * fract(dot(v, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec2 p = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);

  // the graphite light: #2a2a2f in the middle, #18181b at 48%, #070708 at the edge
  float t = clamp(length((p - vec2(0.5, 0.48)) / vec2(1.10, 0.85)), 0.0, 1.0);
  vec3 c0 = vec3(42.0, 42.0, 47.0) / 255.0;
  vec3 c1 = vec3(24.0, 24.0, 27.0) / 255.0;
  vec3 c2 = vec3(7.0, 7.0, 8.0) / 255.0;
  vec3 col = t < 0.48 ? mix(c0, c1, t / 0.48) : mix(c1, c2, (t - 0.48) / 0.52);

  float b = swing(28.0);
  col = glow(col, p, vec2(0.18, 0.28) + vec2(0.10, 0.08) * b, vec2(0.47, 0.38) * mix(1.0, 1.08, b), vec3(47.0, 91.0, 255.0) / 255.0, 0.10);
  float k = swing(34.0);
  col = glow(col, p, vec2(0.845, 0.80) + vec2(-0.10, -0.07) * k, vec2(0.425, 0.38) * mix(1.04, 0.96, k), vec3(255.0, 79.0, 176.0) / 255.0, 0.07);

  // dither: up to one level of noise in each pixel, the same in every channel
  float n = ign(gl_FragCoord.xy) + ign(gl_FragCoord.xy + 5.588238) - 1.0;
  gl_FragColor = vec4(col + n / 255.0, 1.0);
}
`;

export function startAmbient() {
  const canvas = document.createElement('canvas');
  canvas.className = 'ambient-gl';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return false;

  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, VERT);
  const fs = shader(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return false;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);

  // one triangle that covers the whole screen
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(program, 'uRes');
  const uTime = gl.getUniformLocation(program, 'uTime');

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const start = performance.now();
  let last = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(innerHeight * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw(performance.now());
  }

  function draw(now) {
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, still.matches ? 0 : (now - start) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // The drift is slow, so 30 frames a second is plenty and spares the battery.
  function frame(now) {
    requestAnimationFrame(frame);
    if (still.matches || now - last < 33) return;
    last = now;
    draw(now);
  }

  document.body.prepend(canvas);
  document.documentElement.classList.add('gl-ambient');
  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
  return true;
}
