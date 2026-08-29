import { useEffect, useRef } from 'react';

/**
 * A slow raymarched field of stacked squares, drifting under the hero.
 *
 * Tuned to Midnight's palette rather than the usual neon: metallic greys with
 * a cool steel highlight, so it reads as brushed metal under low light instead
 * of a crypto gradient. Renders behind everything and never takes pointer
 * events.
 *
 * WebGL2 with a graceful fallback — if the context is unavailable the canvas
 * simply stays transparent and the CSS ground shows through.
 */

interface Props {
  color1?: string;
  color2?: string;
  color3?: string;
  speed?: number;
  waveDepth?: number;
  zoom?: number;
  density?: number;
  glow?: number;
  exposure?: number;
  spread?: number;
  stepSize?: number;
  contrast?: number;
  brightness?: number;
  opacity?: number;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  mouseRadius?: number;
  grain?: boolean;
  grainIntensity?: number;
  className?: string;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uC1;
uniform vec3  uC2;
uniform vec3  uC3;
uniform float uSpeed;
uniform float uWaveDepth;
uniform float uZoom;
uniform float uDensity;
uniform float uGlow;
uniform float uExposure;
uniform float uSpread;
uniform float uContrast;
uniform float uBrightness;
uniform float uOpacity;
uniform vec2  uMouse;
uniform float uMouseStrength;
uniform float uMouseRadius;
uniform float uGrain;

// Rounded-square mask for one cell, in [-0.5, 0.5] cell space.
float plate(vec2 p, float half_) {
  vec2 d = abs(p) - vec2(half_);
  float outside = length(max(d, 0.0));
  float inside  = min(max(d.x, d.y), 0.0);
  return outside + inside;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / max(uRes.y, 1.0);

  // gentle parallax toward the cursor
  vec2 m = uMouse * 2.0 - 1.0;
  float pull = exp(-length(uv - m) / max(uMouseRadius, 0.001));
  uv += m * pull * uMouseStrength;

  float t = uTime * uSpeed;

  // Perspective tilt: the grid recedes, so plates read as a surface rather
  // than wallpaper. Guarded so the horizon never divides by zero.
  vec2 g = uv * uZoom;
  // Shallower horizon: the plates sweep across the whole frame instead of
  // piling into a vanishing point in the middle.
  float persp = 1.0 / max(0.92 + g.y * 0.34, 0.30);
  vec2 plane = vec2(g.x * persp * 1.25, persp * 1.15 + t * 0.35);

  float cells = max(uDensity, 2.0) * 0.5;
  vec2 cell = plane * cells;
  vec2 id = floor(cell);
  vec2 f = fract(cell) - 0.5;

  // Travelling waves across the grid: this is the motion you actually see —
  // whole ranks of plates lifting and settling.
  float w =
      sin(id.x * 0.55 - t * 1.15)
    + sin(id.y * 0.42 + t * 0.85)
    + sin((id.x + id.y) * 0.30 - t * 0.65);
  w = w / 3.0;                      // -1 .. 1
  float lift = 0.5 + 0.5 * w;       //  0 .. 1

  // Plate size breathes with the wave, so edges travel too.
  float half_ = mix(0.16, 0.46, uSpread * 2.0) * (0.72 + 0.42 * lift);
  float d = plate(f, half_);

  // Body and rim. The rim is what makes it look like brushed metal catching
  // a light rather than flat tiles.
  float aa = 1.6 / max(uRes.y, 1.0) * cells * 2.0 + 0.012;
  float body = 1.0 - smoothstep(0.0, aa, d);
  float rim  = exp(-abs(d) * 26.0) * 0.9;

  float e = (body * 0.55 + rim) * mix(0.35, 1.0, lift) * uGlow;

  // Fade the field out as it recedes. Without this the grid converges into
  // moire near the horizon, which reads as noise rather than depth and eats
  // any text sitting over it.
  float depth = clamp((persp - 0.75) * 1.05, 0.0, 1.0);
  e *= smoothstep(0.0, 0.18, depth) * (1.0 - smoothstep(0.55, 1.0, depth));

  e /= max(uExposure * 0.0012, 0.001);
  e = pow(clamp(e, 0.0, 1.0), max(uContrast, 0.001) * 1.15) * uBrightness;
  e = clamp(e, 0.0, 0.85) * uWaveDepth;

  vec3 col = mix(uC1, uC2, smoothstep(0.02, 0.62, e));
  col = mix(col, uC3, smoothstep(0.55, 0.85, e) * 0.55);

  // The field is UNIFORM across the full width. Readability behind the
  // headline is handled by the CSS scrim above this canvas, not by dimming
  // one side of the shader -- doing that here just left the page half empty.
  col *= 1.0 - 0.26 * dot(uv * 0.42, uv * 0.42);
  col = max(col, uC1 * 0.9);

  if (uGrain > 0.0) {
    float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime) * 43758.5453);
    col += (n - 0.5) * uGrain;
  }

  fragColor = vec4(col, uOpacity);
}`;

export function AcidSquares({
  // Midnight's world: near-black ground, brushed steel, cool highlight.
  color1 = '#0B0F14',
  color2 = '#6E7A88',
  color3 = '#C6CFD8',
  speed = 0.7,
  waveDepth = 1,
  zoom = 1.3,
  density = 10,
  glow = 1,
  exposure = 2700,
  spread = 0.3,
  stepSize = 0.002,
  contrast = 1,
  brightness = 1,
  opacity = 1,
  mouseInteraction = true,
  mouseStrength = 0.1,
  mouseRadius = 0.35,
  grain = true,
  grainIntensity = 0.05,
  className,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true });
    if (!gl) return; // graceful: the CSS ground shows through

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('AcidSquares:', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = {
      res: u('uRes'), time: u('uTime'),
      c1: u('uC1'), c2: u('uC2'), c3: u('uC3'),
      speed: u('uSpeed'), wave: u('uWaveDepth'), zoom: u('uZoom'),
      density: u('uDensity'), glow: u('uGlow'), exposure: u('uExposure'),
      spread: u('uSpread'), contrast: u('uContrast'),
      brightness: u('uBrightness'), opacity: u('uOpacity'),
      mouse: u('uMouse'), mStr: u('uMouseStrength'), mRad: u('uMouseRadius'),
      grain: u('uGrain'),
    };

    gl.uniform3fv(U.c1, hexToRgb(color1));
    gl.uniform3fv(U.c2, hexToRgb(color2));
    gl.uniform3fv(U.c3, hexToRgb(color3));
    gl.uniform1f(U.speed, speed);
    gl.uniform1f(U.wave, waveDepth);
    gl.uniform1f(U.zoom, zoom);
    gl.uniform1f(U.density, density);
    gl.uniform1f(U.glow, glow);
    gl.uniform1f(U.exposure, exposure);
    gl.uniform1f(U.spread, spread);
    gl.uniform1f(U.contrast, contrast);
    gl.uniform1f(U.brightness, brightness);
    gl.uniform1f(U.opacity, opacity);
    gl.uniform1f(U.mStr, mouseInteraction ? mouseStrength : 0);
    gl.uniform1f(U.mRad, mouseRadius);
    gl.uniform1f(U.grain, grain ? grainIntensity : 0);

    const mouse = { x: 0.5, y: 0.5 };
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - r.left) / r.width;
      mouse.y = 1 - (e.clientY - r.top) / r.height;
    };
    if (mouseInteraction) window.addEventListener('mousemove', onMove, { passive: true });

    // Cap the pixel ratio: this is decoration and should never cost a frame.
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(U.res, canvas.width, canvas.height);
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const start = performance.now();

    const frame = (now: number) => {
      resize();
      // Reduced motion gets a near-still field rather than a frozen one:
      // enough drift that it does not read as a broken image.
      const elapsed = (now - start) / 1000;
      gl.uniform1f(U.time, reduced ? elapsed * 0.06 : elapsed);
      gl.uniform2f(U.mouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      if (mouseInteraction) window.removeEventListener('mousemove', onMove);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, [color1, color2, color3, speed, waveDepth, zoom, density, glow, exposure,
      spread, stepSize, contrast, brightness, opacity, mouseInteraction,
      mouseStrength, mouseRadius, grain, grainIntensity]);

  return <canvas ref={ref} className={className} aria-hidden />;
}

export default AcidSquares;
