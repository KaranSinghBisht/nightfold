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
uniform float uStep;
uniform float uContrast;
uniform float uBrightness;
uniform float uOpacity;
uniform vec2  uMouse;
uniform float uMouseStrength;
uniform float uMouseRadius;
uniform float uGrain;

// Distance to a stack of axis-aligned squares, warped by a slow wave. The
// squares are what give the field its plated, panelled look.
float field(vec3 pos) {
  float t = uTime * uSpeed;
  pos.xy *= uZoom;

  // slow travelling wave so the plates breathe rather than scroll
  pos.z += sin(pos.x * 0.6 + t * 0.5) * uWaveDepth * 0.35;
  pos.z += cos(pos.y * 0.5 - t * 0.4) * uWaveDepth * 0.35;

  vec3 q = pos;
  float cell = 6.2831853 / max(uDensity, 1.0);
  q.xy = mod(q.xy + cell * 0.5, cell) - cell * 0.5;

  // square cross-section, softened
  vec2 d2 = abs(q.xy) - vec2(cell * uSpread);
  float sq = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0);
  return sq - 0.02;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / max(uRes.y, 1.0);

  // gentle parallax toward the cursor
  vec2 m = (uMouse * 2.0 - 1.0);
  float pull = exp(-length(uv - m) / max(uMouseRadius, 0.001));
  uv += m * pull * uMouseStrength;

  vec3 ro = vec3(0.0, 0.0, -3.0);
  vec3 rd = normalize(vec3(uv, 1.4));

  float acc = 0.0;
  float dist = 0.0;
  // fixed low step count: this sits behind text and must stay cheap
  for (int i = 0; i < 46; i++) {
    vec3 pos = ro + rd * dist;
    float d = field(pos);
    // accumulate glow near surfaces rather than hard-hitting them
    acc += uGlow * 0.02 / (abs(d) + 0.045);
    dist += max(abs(d) * 0.6, uStep * 40.0);
    if (dist > 9.0) break;
  }

  // This sits BEHIND headline type, so it has to stay dark. The exposure
  // divisor is large and the result is clamped well below 1: the field reads
  // as brushed metal catching a little light, never as a lit surface.
  float e = acc / max(uExposure * 0.022, 0.001);
  e = pow(clamp(e, 0.0, 1.0), max(uContrast, 0.001) * 1.25) * uBrightness;
  e = clamp(e, 0.0, 0.62);

  // Metallic ramp: deep ground -> brushed steel, with a narrow cool highlight
  // only where the plate edges catch the light.
  vec3 col = mix(uC1, uC2, smoothstep(0.01, 0.50, e));
  col = mix(col, uC3, smoothstep(0.42, 0.62, e) * 0.45);

  // Directional falloff rather than a symmetric vignette: the left third is
  // where the headline sits, so it stays near the page ground while the plates
  // read clearly on the right.
  float toLeft = smoothstep(-1.5, 0.35, uv.x);
  col = mix(uC1 * 0.92, col, 0.22 + 0.78 * toLeft);
  col *= 1.0 - 0.42 * dot(uv * 0.55, uv * 0.55);
  col = max(col, uC1 * 0.88);

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
      spread: u('uSpread'), step: u('uStep'), contrast: u('uContrast'),
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
    gl.uniform1f(U.step, stepSize);
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
      // Held still for anyone who asked for reduced motion.
      gl.uniform1f(U.time, reduced ? 0 : (now - start) / 1000);
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
