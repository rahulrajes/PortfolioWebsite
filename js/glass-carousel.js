/* ==========================================================================
   Rahul Rajesh — liquid glass carousel
   --------------------------------------------------------------------------
   Plain-JS port of Originkit's "Liquid Glass Carousel"
   (ui_for_photography/liquid_glass_carousel.tsx), "base" preset.

   An endless row of photo cards is drawn to an offscreen buffer, then redrawn
   through a glass lens that bends, splits color, and glows at the rim.
   Scroll / drag / flick to move; it settles on the nearest card. Click a card
   to bring it to the center, click the center card to focus it (the others
   drop away), and click the focused card to open the full-size photo.

   Changes from the original, for a photo gallery:
     - photo sizes come from content/photos.json, so the row never reflows
     - photos load a few at a time, nearest first, instead of all up front
     - unloaded cards are dark (not light gray) on the black page
     - onOpen(index) hook for the lightbox; Esc is left to the lightbox when open
     - no darkening: photos keep their original colors and brightness (the
       original's color-space mismatch, center dim, and white haze are gone)
     - glassMode "frame" (default): instead of one lens in the middle, every
       card gets its own thin glass edge (see FRAME LOOK). "lens" brings back
       the original single lens (see LENS LOOK).

   Usage (ES module; needs "three" in the page's import map):
     import { createCarousel } from "./glass-carousel.js";
     const c = createCarousel(mountEl, { onOpen: (i) => ... });
     c.setItems([{ src, aspect }, ...]);
   ========================================================================== */
import * as THREE from "three";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const outPow = (n) => (t) => 1 - Math.pow(1 - t, n);
const inOutPow = (n) => (t) => (t < 0.5 ? Math.pow(2 * t, n) / 2 : 1 - Math.pow(2 - 2 * t, n) / 2);
const OUT3 = outPow(3);
const INOUT2 = inOutPow(2);
const INOUT3 = inOutPow(3);
const EXPO_INOUT = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;

/* ---- a tiny tween runner (no animation library needed) ---- */
class Timeline {
  constructor(delay = 0) { this.tracks = []; this.calls = []; this.time = -delay; this.dead = false; }
  to(obj, key, to, dur, ease, at = 0) {
    this.tracks.push({ obj, key: String(key), from: null, to, dur: Math.max(0.0001, dur), at, ease });
    return this;
  }
  call(fn, at) { this.calls.push({ at, fn, fired: false }); return this; }
  step(dt) {
    if (this.dead) return;
    this.time += dt;
    for (const tr of this.tracks) {
      const u = (this.time - tr.at) / tr.dur;
      if (u < 0) continue;
      if (tr.from === null) tr.from = tr.obj[tr.key] ?? 0;
      tr.obj[tr.key] = tr.from + (tr.to - tr.from) * tr.ease(clamp01(u));
    }
    for (const c of this.calls) {
      if (!c.fired && this.time >= c.at) { c.fired = true; c.fn(); }
    }
  }
  kill() { this.dead = true; this.tracks.length = 0; this.calls.length = 0; }
}

/* ---- the lens shader (unchanged from the original) ---- */
const lensVertexShader = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const lensFragmentShader = `
  #define PI 3.14159265
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec2  uRes;
  uniform vec2  uCenter;
  uniform float uSizeX;
  uniform float uSizeY;
  uniform float uAspect;
  uniform float uZoom;
  uniform float uDispersion;
  uniform float uBlur;
  uniform float uGlow;
  uniform float uWhiteGlow;
  uniform float uNovaSize;
  uniform float uBlueRing;
  uniform float uRingRadius;
  uniform float uRingWidth;
  uniform float uShimmer;
  uniform float uShimmerFreq;
  uniform float uShimmerSpeed;
  uniform float uShimmerDepth;
  uniform float uTime;
  uniform float uRimStart;
  uniform float uRimTangential;
  uniform float uRimInward;
  uniform float uRimFreq1;
  uniform float uRimFreq2;
  uniform vec3  uBlueColor;
  uniform float uRimLine;
  uniform float uRimLinePos;
  uniform float uRimLineWidth;
  uniform float uVignette;
  uniform float uVignetteSize;
  uniform float uShape;
  uniform float uSquareRound;
  uniform float uRotation;
  uniform int   uSamples;

  const int MAX_SAMPLES = 16;

  float sdRoundBox(vec2 p, vec2 b, float r){
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  vec3 discLens(vec2 center, float aspectCorrect, out float outA) {
    vec2 p = (vUv - center);
    p.x *= aspectCorrect;

    float ca = cos(uRotation), sa = sin(uRotation);
    p = mat2(ca, -sa, sa, ca) * p;
    vec2 halfSize = vec2(uSizeX, uSizeY);

    float dist = length(p / halfSize);
    outA = 0.0;

    float maskND;
    if (uShape > 0.5) {
      float corner = min(uSizeX, uSizeY) * clamp(uSquareRound, 0.0, 1.0);
      float sd = sdRoundBox(p, halfSize, corner);
      maskND = 1.0 + sd / min(uSizeX, uSizeY);
    } else {
      maskND = dist;
    }
    if (maskND > 1.0) return vec3(0.0);

    float shapeND = clamp(maskND, 0.0, 1.0);

    float nd = clamp(dist, 0.0, 1.0);
    vec2  offset = vUv - center;
    vec2  radialDir = normalize(offset + 1e-6);
    vec2  tangentDir = vec2(-radialDir.y, radialDir.x);

    float angle = atan(p.y, p.x);

    float pull = uZoom * 0.30 * (nd * nd);
    float rimStrength = smoothstep(uRimStart, 1.0, nd);
    float fluidWave = sin(angle * uRimFreq1) * 0.55 + sin(angle * uRimFreq2) * 0.25;
    float rScreen = (uSizeX + uSizeY) * 0.5;
    vec2  rimOff = tangentDir * fluidWave * rimStrength * rScreen * uRimTangential;
    vec2  rimPull = -radialDir * rimStrength * rScreen * uRimInward;

    vec2 baseUV = center + offset * (1.0 - pull) + rimOff + rimPull;

    float rimMask = smoothstep(0.55, 1.0, nd);
    vec2  dispDir = offset * uDispersion * 0.004 * rimMask;
    int N = uSamples;
    if (N < 2) N = 2;
    if (N > MAX_SAMPLES) N = MAX_SAMPLES;
    vec3 col = vec3(0.0);

    if (uDispersion < 0.01) {
      col = texture2D(uTex, baseUV).rgb;
    } else {
      vec3 caW = vec3(0.0);
      for (int i = 0; i < MAX_SAMPLES; i++) {
        if (i >= N) break;
        float t = float(i) / float(N - 1);
        vec2 sUV = baseUV + dispDir * (t - 0.5);
        vec3 s = texture2D(uTex, sUV).rgb;
        vec3 w = vec3(
          exp(-pow((t - 0.00) / 0.38, 2.0)),
          exp(-pow((t - 0.50) / 0.38, 2.0)),
          exp(-pow((t - 1.00) / 0.38, 2.0))
        );
        col += s * w;
        caW += w;
      }
      col /= max(caW, vec3(0.001));
    }

    float blurFade = 1.0 - smoothstep(0.72, 0.98, nd);
    if (uBlur > 0.01 && blurFade > 0.01) {
      vec2 blurRad = vec2(uBlur) / uRes * blurFade;
      vec3 bcol = vec3(0.0);
      float btw = 0.0;
      for (float a = 0.0; a < PI * 2.0; a += PI * 2.0 / 6.0) {
        for (float rr = 0.4; rr <= 1.001; rr += 0.3) {
          vec2 o = vec2(cos(a), sin(a)) * blurRad * rr;
          float w = 1.0 - rr * 0.38;
          bcol += texture2D(uTex, baseUV + o).rgb * w;
          btw += w;
        }
      }
      col = mix(bcol / btw, col, rimMask);
    }

    // (the original dimmed the lens center 9% here; removed so photos keep their true brightness)

    float r2 = shapeND * shapeND * 0.25;
    float gs = max(uNovaSize * uGlow * 0.003, 0.004);
    float nova = exp(-r2 / gs) + exp(-r2 / (gs * 7.0)) * 0.18;
    nova *= uWhiteGlow * (uGlow / 17.0) * 1.15;
    col += vec3(nova);

    float dC = shapeND * 0.5;
    float tR = clamp(uRingRadius, 0.1, 0.49);
    float rW = max(uRingWidth, 0.003);
    float ring = exp(-pow((dC - tR) / rW, 2.0));
    ring *= uBlueRing * (uGlow / 17.0) * 1.8;
    if (uShimmer > 0.5) ring *= sin(angle * uShimmerFreq + uTime * uShimmerSpeed) * uShimmerDepth + (1.0 - uShimmerDepth);

    float ringAura = exp(-pow((dC - tR) / (rW * 4.0), 2.0)) * 0.2 * uBlueRing * (uGlow / 17.0);
    col += uBlueColor * (ring + ringAura);

    vec3 edgeCol = mix(vec3(1.0), uBlueColor, 0.55);
    col += edgeCol * (exp(-pow((dC - uRimLinePos) / max(uRimLineWidth, 0.0001), 2.0)) * uRimLine);

    outA = smoothstep(1.0, 0.93, maskND);
    return col;
  }

  void main(){
    vec3 base = texture2D(uTex, vUv).rgb;
    vec3 outc = base;

    float a = 0.0;
    vec3 c = discLens(uCenter, uAspect, a);
    outc = mix(outc, c, a);

    if (uVignette > 0.001) {
      vec2 vc = vUv - 0.5;
      vc.x *= uAspect;
      float d = length(vc) / max(uVignetteSize, 0.0001);
      float vig = 1.0 - uVignette * smoothstep(0.5, 1.0, d);
      outc *= clamp(vig, 0.0, 1.0);
    }

    gl_FragColor = vec4(outc, 1.0);
  }
`;

/* ---- per-card glass frame (glassMode "frame") ----
   Each photo is its own pane of glass: a thin bevel around the edge bends
   the photo inward, splits color slightly, and catches a soft highlight on
   the top-left rim. Everything inside the bevel is the untouched photo. */
const frameVertexShader = `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const frameFragmentShader = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D map;
  uniform float uHasMap;
  uniform vec3  uColor;        // unloaded card color
  uniform vec2  uSize;         // card size on screen, px
  uniform vec2  uRepeat;       // crop window (from the texture's repeat/offset)
  uniform vec2  uOffset;
  uniform float uRadius;       // corner radius, px
  uniform float uBand;         // bevel width, px
  uniform float uBend;         // how far the bevel pulls the photo inward, px
  uniform float uDisp;         // color split, as a fraction of uBend
  uniform float uRim;          // rim light strength
  uniform vec3  uRimColor;

  float sdBox(vec2 p, vec2 b, float r){
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }
  vec3 photo(vec2 uv){ return texture2D(map, clamp(uv, 0.0, 1.0) * uRepeat + uOffset).rgb; }

  void main(){
    vec2 hb = uSize * 0.5;
    vec2 p = (vUv - 0.5) * uSize;                 // px from the card's center
    float r = min(uRadius, min(hb.x, hb.y));
    float sd = sdBox(p, hb, r);                  // < 0 inside
    float d = -sd;                                // px in from the edge
    if (d <= 0.0) discard;
    float edgeA = clamp(d, 0.0, 1.0);            // 1px anti-aliased edge

    if (uHasMap < 0.5) { gl_FragColor = vec4(uColor, edgeA); return; }

    // outward direction at this point (gradient of the box shape)
    vec2 e = vec2(0.75, 0.0);
    vec2 n = normalize(vec2(sdBox(p + e.xy, hb, r) - sdBox(p - e.xy, hb, r),
                            sdBox(p + e.yx, hb, r) - sdBox(p - e.yx, hb, r)) + 1e-6);

    // small cards (during the intro) get a proportionally thinner edge
    float band = min(uBand, 0.07 * min(uSize.x, uSize.y));
    float bend = uBend * band / max(uBand, 0.001);
    float t = 1.0 - clamp(d / max(band, 0.001), 0.0, 1.0);    // 0 inside the bevel .. 1 at the edge
    float k = t * t;                                          // curved bevel profile
    vec2 pull = -n * k * bend / uSize;                        // bend toward the middle

    // Sample the same way on every pixel. (An if/else here made the GPU pick a
    // blurrier copy of the photo along the bevel's inner edge, which showed up
    // as a faint rectangle inside each card.)
    vec3 col;
    col.r = photo(vUv + pull * (1.0 + uDisp)).r;
    col.g = photo(vUv + pull).g;
    col.b = photo(vUv + pull * (1.0 - uDisp)).b;

    // light: a hairline along the very edge, plus a soft glint on the top-left bevel
    float line  = exp(-pow((d - 1.2) / 0.9, 2.0));
    float glint = pow(max(dot(n, normalize(vec2(-0.6, 0.8))), 0.0), 2.0) * k;
    col += uRimColor * uRim * (line * 0.55 + glint * 0.35);

    gl_FragColor = vec4(min(col, vec3(1.0)), edgeA);
  }
`;

/* ---- card sizing: "image" keeps each photo's own shape (no cropping);
        "same" crops every card to CARD_W x panel height like the demo ---- */
const hash01 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const UNIFORM = { w: 1, h: 1 };
const SIZE_MODES = {
  same: () => UNIFORM,
  alternate: (i) => (i % 2 === 0 ? UNIFORM : { w: 0.62, h: 1 }),
  random: (i) => ({ w: 0.6 + 0.4 * hash01(i), h: 0.7 + 0.3 * hash01(i + 97) }),
  image: () => UNIFORM,
};
const FROM_BOTTOM = { x: 0, y: -1 };

/* ---- settings (the Originkit "base" preset, tuned for photos) ---- */
function makeParams(opts) {
  const sens = 6.2, glide = 6.8;                     // Motion: sensitivity, glide
  const ease = clamp(0.18 * Math.pow(0.5, glide / 5), 0.02, 0.4);
  return {
    panelH: opts.cardHeight || 440,
    cardW: opts.cardWidth || 400,
    sizeMode: opts.sizeMode || "image",
    gap: opts.gap ?? 12,
    shrinkMax: 0.25, shrinkSpeed: 60, shrinkAttack: 0.25, shrinkDecay: 0.06,

    ease,
    snapEase: ease * 0.56,
    wheelSpeed: 0.28 * sens,
    dragSpeed: 0.32 * sens,
    touchDrag: 1.0,
    touchEase: 0.22,
    friction: 0.865,
    snap: true,
    snapIdleMs: 120,
    clickSlop: 6,
    touchClickSlop: 12,
    flickIdleMs: 90,

    focus: { cardDuration: 0.7, focusDuration: 0.9, stagger: 0.06, dropDist: 1.4, centerScale: 1.18, lensFade: 0.85, ease: OUT3 },

    entry: {
      enabled: !opts.reduceMotion,
      delay: 0.5, startH: 80, riseDuration: 1.0, ease: OUT3, stagger: 0.07, travel: 0.9,
      pattern: () => FROM_BOTTOM,
      growDelay: 0.25, growDuration: 2.15, growStagger: 0.085, outward: false, lensBloom: 1.4,
    },

    /* ---- GLASS STYLE ----
       "frame": a glass edge around every photo (current look)
       "lens":  one big lens fixed in the middle that photos slide under (Originkit's look) */
    glassMode: "frame",

    /* ---- FRAME LOOK (glassMode "frame"): edit these to tune the glass edge ---- */
    frame: {
      band: 16,             // width of the glass edge, px (0 = no glass)
      bend: 9,              // how far the edge pulls the photo inward, px
      dispersion: 0.35,     // rainbow split at the edge (0 = none)
      rim: 0.8,             // brightness of the edge highlight (0 = none)
      rimColor: "#eef4ff",  // highlight color
      radius: 8,            // corner rounding, px
    },

    /* ---- LENS LOOK (glassMode "lens"): edit these to tune the big lens ----
       The originals from Originkit's base preset are in [brackets]. */
    lens: {
      sizeX: 0.8,          // lens width (bigger = the bend stays farther out)   [0.565]
      sizeY: 1,             // lens height                                        [1]
      rotation: 65,          // tilt in degrees; 0 = upright oval                  [65]
      rimStart: 0.578,       // where bending starts, 0 center .. 1 edge; higher = only the rim bends  [0.578]
      rimTangential: 0.3,  // how hard the rim warps the photo                   [0.6]
      dispersion: 11,        // rainbow color fringe at the rim                    [11]
      ring: 1,            // brightness of the thin rim light (0 = none)        [1]
      ringWidth: 0.014,     // thickness of the rim light                         [0.014]
      ringColor: "#009dff", // rim light color                                     [#009dff]
      shimmer: false,       // rim light flickers around the edge                 [true]

      // rarely touched
      square: false, round: 0, posX: 0.5, posY: 0.5, spin: 0, zoom: 0, blur: 0,
      glow: 3, whiteGlow: 0, novaSize: 12, ringRadius: 0.49,
      shimmerFreq: 12, shimmerSpeed: 3.5, shimmerDepth: 0.12,
      rimInward: 0, rimFreq1: 2, rimFreq2: 1,
      rimLine: 0, rimLinePos: 0.488, rimLineWidth: 0.003,
      vignette: 0, vignetteSize: 0.3, samples: 16,
    },

    background: "#000000",
    cardColor: 0x141414,        // unloaded card
    loadAhead: 4,               // photos downloading at once
    bootAfter: 6,               // start the entry once this many are in (or after BOOT_MS)
  };
}

const REPEATS = 4;
const BOOT_MS = 3500;

export function createCarousel(mount, opts = {}) {
  const pp = makeParams(opts);
  const onOpen = typeof opts.onOpen === "function" ? opts.onOpen : null;
  let disposed = false;

  let W = Math.max(1, mount.clientWidth);
  let H = Math.max(1, mount.clientHeight);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(new THREE.Color(pp.background), 1);

  const el = renderer.domElement;
  el.className = "glass__canvas";
  el.style.position = "absolute";
  el.style.left = "0";
  el.style.top = "0";
  el.style.display = "block";
  el.style.touchAction = "none";
  el.style.userSelect = "none";
  el.style.setProperty("-webkit-user-select", "none");
  el.style.setProperty("-webkit-touch-callout", "none");
  el.style.setProperty("-webkit-tap-highlight-color", "transparent");
  mount.appendChild(el);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -100, 100);
  camera.position.z = 10;

  const loader = new THREE.TextureLoader();

  let sources = [];
  let pool = [];
  let owned = [];
  let offsets = [];
  let totalWidth = 0;

  // card height: the preset size, shrunk to fit short windows and narrow phones
  function panelHeight() { return Math.min(pp.panelH, Math.max(40, H * 0.86), Math.max(120, W * 0.55)); }
  function sizing(i) { return (SIZE_MODES[pp.sizeMode] || SIZE_MODES.same)(i); }
  function cardHeight(i) { return panelHeight() * sizing(i).h; }
  function widthAt(i, h) {
    if (pp.sizeMode === "image") return sources[i].aspect * h;
    const rest = cardHeight(i);
    return pp.cardW * sizing(i).w * (rest > 0 ? h / rest : 1);
  }
  function slotWidth(i) { return widthAt(i, cardHeight(i)) + pp.gap; }

  // crop window so a photo covers a card of a different shape ("same" mode)
  function coverWindow(i) {
    const h = cardHeight(i);
    const card = h > 0 ? widthAt(i, h) / h : 1;
    const art = sources[i].aspect || 1;
    if (Math.abs(card - art) < 1e-6) return { rx: 1, ox: 0, ry: 1, oy: 0 };
    if (card > art) { const ry = art / card; return { rx: 1, ox: 0, ry, oy: (1 - ry) / 2 }; }
    const rx = card / art;
    return { rx, ox: (1 - rx) / 2, ry: 1, oy: 0 };
  }

  function recomputeTotal() {
    offsets = [];
    let acc = 0;
    for (let i = 0; i < sources.length; i++) { offsets.push(acc); acc += slotWidth(i); }
    totalWidth = acc;
  }

  function centerForIndex(idx) {
    const N = sources.length;
    if (!N) return 0;
    const loop = Math.floor(idx / N);
    const s = ((idx % N) + N) % N;
    return offsets[s] + slotWidth(s) / 2 - pp.gap / 2 + loop * totalWidth;
  }

  function nearestIndex(value) {
    const N = sources.length;
    if (!totalWidth || !N) return 0;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < N; i++) {
      const center = offsets[i] + slotWidth(i) / 2 - pp.gap / 2;
      const k = Math.round((value - center) / totalWidth);
      const dist = Math.abs(center + k * totalWidth - value);
      if (dist < bestDist) { bestDist = dist; best = i + k * N; }
    }
    return best;
  }

  function centerIndex(value) {
    if (!totalWidth || !sources.length) return 0;
    let bestI = 0, bestDist = Infinity;
    for (let i = 0; i < sources.length; i++) {
      const center = offsets[i] + slotWidth(i) / 2 - pp.gap / 2;
      const k = Math.round((value - center) / totalWidth);
      const dist = Math.abs(center + k * totalWidth - value);
      if (dist < bestDist) { bestDist = dist; bestI = i; }
    }
    return bestI;
  }

  let scroll = 0, target = 0, velocity = 0, prevScroll = 0, scrollEnergy = 0;
  let pendingFocus = null;
  let lastInput = performance.now();
  let snapped = false;

  const focusState = { active: false, srcIndex: -1, poolIdx: -1, lensFx: 1 };
  const focusZoom = { v: 1 };
  let drop = [], pEntry = [], growArr = [], lastCenterX = [];
  let entryActive = false, entrySettled = false, closing = false;
  let focusTl = null, entryTl = null;

  /* ---- lens pass ---- */
  const dpr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.round(W * dpr)), Math.max(1, Math.round(H * dpr)));
  const lensScene = new THREE.Scene();
  const lensCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const L = pp.lens;
  const lensU = {
    uTex: { value: rt.texture },
    uRes: { value: new THREE.Vector2(W * dpr, H * dpr) },
    uCenter: { value: new THREE.Vector2(L.posX, L.posY) },
    uSizeX: { value: L.sizeX }, uSizeY: { value: L.sizeY },
    uShape: { value: L.square ? 1 : 0 }, uSquareRound: { value: L.round },
    uRotation: { value: 0 }, uAspect: { value: W / H }, uZoom: { value: 0 },
    uDispersion: { value: L.dispersion }, uBlur: { value: L.blur },
    uGlow: { value: L.glow }, uWhiteGlow: { value: L.whiteGlow }, uNovaSize: { value: L.novaSize },
    uBlueRing: { value: L.ring }, uRingRadius: { value: L.ringRadius }, uRingWidth: { value: L.ringWidth },
    uShimmer: { value: L.shimmer ? 1 : 0 }, uShimmerFreq: { value: L.shimmerFreq },
    uShimmerSpeed: { value: L.shimmerSpeed }, uShimmerDepth: { value: L.shimmerDepth },
    uTime: { value: 0 },
    uRimStart: { value: L.rimStart }, uRimTangential: { value: L.rimTangential }, uRimInward: { value: L.rimInward },
    uRimFreq1: { value: L.rimFreq1 }, uRimFreq2: { value: L.rimFreq2 },
    uBlueColor: { value: new THREE.Color(L.ringColor) },
    uRimLine: { value: L.rimLine }, uRimLinePos: { value: L.rimLinePos }, uRimLineWidth: { value: L.rimLineWidth },
    uVignette: { value: L.vignette }, uVignetteSize: { value: L.vignetteSize },
    uSamples: { value: L.samples },
  };
  const lensMat = new THREE.ShaderMaterial({ uniforms: lensU, vertexShader: lensVertexShader, fragmentShader: lensFragmentShader });
  const lensQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lensMat);
  lensScene.add(lensQuad);
  try { renderer.compile(lensScene, lensCam); } catch (e) { /* compiled on first draw instead */ }

  function syncLens(now) {
    const rad = (a) => (a * Math.PI) / 180;
    lensU.uAspect.value = W / H;
    lensU.uTime.value = now * 0.001;
    lensU.uRotation.value = rad(L.rotation) + rad(L.spin) * (now * 0.001);
    const fx = focusState.lensFx;
    lensU.uDispersion.value = L.dispersion * fx;
    lensU.uBlueRing.value = L.ring * fx;
    lensU.uRimLine.value = L.rimLine * fx;
    lensU.uVignette.value = L.vignette * fx;
    lensU.uZoom.value = L.zoom * fx;
    lensU.uRimTangential.value = L.rimTangential * fx;
    lensU.uRimInward.value = L.rimInward * fx;
  }

  function disposeContent() {
    pool.forEach((p) => { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mat.dispose(); });
    pool = [];
    owned.forEach((t) => t.dispose());
    owned = [];
    sources = [];
  }

  /* ---- loading: nearest cards first, a few at a time ---- */
  let generation = 0;
  let ready = false;
  let bootTimer = null;
  let queue = [], inFlight = 0, loadedCount = 0;

  function boot() {
    if (disposed || ready) return;
    if (bootTimer !== null) { clearTimeout(bootTimer); bootTimer = null; }
    ready = true;
    recomputeTotal();
    scroll = centerForIndex(nearestIndex(scroll));
    target = scroll;
    prevScroll = scroll;
    if (pp.entry.enabled) playEntry();
    else { entryActive = false; entrySettled = false; }
  }

  function pump(gen) {
    while (inFlight < pp.loadAhead && queue.length && gen === generation) {
      const i = queue.shift();
      const s = sources[i];
      inFlight++;
      loader.load(
        s.src,
        (tex) => {
          if (disposed || gen !== generation) { tex.dispose(); return; }
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = true;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          // Leave the photo's colors as-is. Tagging it sRGB made three.js convert it
          // to linear for the offscreen pass, and the lens pass never converted it
          // back, which darkened every photo.
          tex.colorSpace = THREE.NoColorSpace;
          s.tex = tex;
          owned.push(tex);
          try { renderer.initTexture(tex); } catch (e) { /* uploads on first draw */ }
          done(gen);
        },
        undefined,
        () => { if (!disposed && gen === generation) done(gen); }   // leave the dark card
      );
    }
  }
  function done(gen) {
    inFlight--;
    loadedCount++;
    if (!ready && loadedCount >= Math.min(pp.bootAfter, sources.length)) boot();
    pump(gen);
  }

  function setItems(list) {
    if (disposed) return;
    disposeContent();
    const gen = ++generation;
    ready = false;
    if (bootTimer !== null) clearTimeout(bootTimer);
    bootTimer = setTimeout(boot, BOOT_MS);
    queue = []; inFlight = 0; loadedCount = 0;

    sources = list.map((item) => ({ src: item.src, tex: null, aspect: item.aspect || 1 }));

    for (let r = 0; r < REPEATS; r++) {
      for (let i = 0; i < sources.length; i++) {
        const mat = makeCardMaterial();
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), mat);
        mesh.visible = false;
        scene.add(mesh);
        pool.push({ mesh, mat, srcIndex: i, bound: false });
      }
    }

    recomputeTotal();
    const n = pool.length;
    drop = new Array(n).fill(0);
    pEntry = new Array(n).fill(1);
    growArr = new Array(n).fill(1);
    lastCenterX = new Array(n);
    focusState.active = false;
    focusState.srcIndex = -1;
    focusState.poolIdx = -1;
    focusState.lensFx = 1;
    focusZoom.v = 1;
    velocity = 0;
    scroll = centerForIndex(0);
    target = scroll;
    prevScroll = scroll;
    if (focusTl) focusTl.kill();
    focusTl = null;
    if (entryTl) entryTl.kill();
    entryTl = null;

    // load order: 0, 1, N-1, 2, N-2, ... (outward from the first card)
    const N = sources.length;
    for (let k = 0; k < N; k++) {
      const i = k === 0 ? 0 : k % 2 ? (k + 1) / 2 : N - k / 2;
      if (!queue.includes(i)) queue.push(i);
    }
    if (!N) boot();
    else pump(gen);
  }

  // one glass-frame material per card (they all share one compiled shader)
  const FR = pp.frame;
  const rimColor = new THREE.Color(FR.rimColor);
  const cardColor = new THREE.Color(pp.cardColor);
  function makeCardMaterial() {
    return new THREE.ShaderMaterial({
      vertexShader: frameVertexShader,
      fragmentShader: frameFragmentShader,
      transparent: true,
      uniforms: {
        map: { value: null },
        uHasMap: { value: 0 },
        uColor: { value: cardColor },
        uSize: { value: new THREE.Vector2(1, 1) },
        uRepeat: { value: new THREE.Vector2(1, 1) },
        uOffset: { value: new THREE.Vector2(0, 0) },
        uRadius: { value: FR.radius },
        uBand: { value: pp.glassMode === "frame" ? FR.band : 0 },
        uBend: { value: FR.bend },
        uDisp: { value: FR.dispersion },
        uRim: { value: pp.glassMode === "frame" ? FR.rim : 0 },
        uRimColor: { value: rimColor },
      },
    });
  }

  function syncWindows() {
    for (let i = 0; i < sources.length; i++) {
      const tex = sources[i].tex;
      if (!tex) continue;
      const base = coverWindow(i);
      tex.repeat.set(base.rx, base.ry);
      tex.offset.set(base.ox, (1 - base.ry) * 0.5);
    }
  }

  /* ---- place every card for this frame ---- */
  let panelRects = [];
  let centeredPanel = null;

  function layout() {
    panelRects = [];
    centeredPanel = null;
    let centeredDist = Infinity;
    const N = sources.length;
    if (!N || !totalWidth || !ready) { for (const p of pool) p.mesh.visible = false; return; }
    const half = W / 2;
    const panelH = panelHeight();
    const buffer = panelH;
    const E = pp.entry;

    pool.forEach((p, poolIdx) => {
      const rep = Math.floor(poolIdx / N);
      const i = p.srcIndex;
      const src = sources[i];

      const slotCenterInLoop = offsets[i] + slotWidth(i) / 2 - pp.gap / 2;
      let x = slotCenterInLoop - scroll;
      x = ((x % totalWidth) + totalWidth) % totalWidth;
      x += (rep - Math.floor(REPEATS / 2)) * totalWidth;
      if (x > half + totalWidth) x -= totalWidth * REPEATS;

      const centerX = x;
      const inEntry = entryActive || entrySettled;
      if (!inEntry && (centerX < -half - buffer || centerX > half + buffer)) {
        p.mesh.visible = false;
        lastCenterX[poolIdx] = undefined;
        return;
      }
      lastCenterX[poolIdx] = centerX;

      const shrink = 1 - pp.shrinkMax * scrollEnergy;
      const h = cardHeight(i) * shrink;
      const wPx = widthAt(i, h);

      const U = p.mat.uniforms;
      if (src.tex && !p.bound) {
        U.map.value = src.tex;
        U.uHasMap.value = 1;
        p.bound = true;
      }
      if (src.tex) { U.uRepeat.value.copy(src.tex.repeat); U.uOffset.value.copy(src.tex.offset); }

      let y = 0;
      const isFocused = focusState.active && focusState.poolIdx === poolIdx;
      const d = drop[poolIdx] || 0;
      let drawW = wPx, drawH = h;
      if (isFocused) { drawW = wPx * focusZoom.v; drawH = h * focusZoom.v; }
      else if (d > 0) y -= d * H * pp.focus.dropDist;

      p.mesh.visible = true;
      let finalX = centerX, finalY = y, finalW = drawW, finalH = drawH;

      if (inEntry) {
        const pe = pEntry[poolIdx] || 0;
        const gr = growArr[poolIdx] || 0;
        const startH = Math.min(E.startH, panelH * 0.5);
        const curH = startH + (drawH - startH) * gr;
        finalH = curH;
        finalW = widthAt(i, curH);

        const midRep = Math.floor(REPEATS / 2);
        if (rep !== midRep) { p.mesh.visible = false; lastCenterX[poolIdx] = undefined; return; }
        const cSrc = centerIndex(scroll);
        let di = i - cSrc;
        if (di > N / 2) di -= N;
        if (di < -N / 2) di += N;
        const slotH = (s) => { const gg = growArr[midRep * N + s] || 0; return startH + (cardHeight(s) - startH) * gg; };
        let off = 0;
        if (di > 0) {
          for (let k = 0; k < di; k++) {
            const sa = (((cSrc + k) % N) + N) % N, sb = (((cSrc + k + 1) % N) + N) % N;
            off += (widthAt(sa, slotH(sa)) + widthAt(sb, slotH(sb))) / 2 + pp.gap;
          }
        } else if (di < 0) {
          for (let k = 0; k < -di; k++) {
            const sa = (((cSrc - k) % N) + N) % N, sb = (((cSrc - k - 1) % N) + N) % N;
            off -= (widthAt(sa, slotH(sa)) + widthAt(sb, slotH(sb))) / 2 + pp.gap;
          }
        }
        finalX = off;
        if (finalX < -half - buffer || finalX > half + buffer) { p.mesh.visible = false; lastCenterX[poolIdx] = undefined; return; }

        const dir = E.pattern(i, N, di);
        const fromX = finalX + dir.x * W * E.travel;
        const fromY = dir.y * H * E.travel;
        finalX = fromX + (finalX - fromX) * pe;
        finalY = fromY + (y - fromY) * pe;
      }

      p.mesh.position.set(finalX, finalY, 0);
      p.mesh.scale.set(Math.max(1, finalW), Math.max(1, finalH), 1);
      U.uSize.value.set(Math.max(1, finalW), Math.max(1, finalH));   // keeps the glass edge a fixed px width

      const sx = centerX + W / 2;
      const sy = H / 2 - y;
      panelRects.push({ left: sx - drawW / 2, right: sx + drawW / 2, top: sy - drawH / 2, bottom: sy + drawH / 2, poolIdx, srcIndex: i, centerX });

      if (Math.abs(centerX) < centeredDist) {
        centeredDist = Math.abs(centerX);
        centeredPanel = { srcIndex: i, centerX, wPx, h, poolIdx };
      }
    });
  }

  function panelAtPointer(px, py) {
    for (let i = 0; i < panelRects.length; i++) {
      const r = panelRects[i];
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return r;
    }
    return null;
  }

  /* ---- input: wheel, drag / flick, click ---- */
  let bounds = mount.getBoundingClientRect();
  const readBounds = () => { bounds = mount.getBoundingClientRect(); };

  let dragging = false, dragPointerId = null, dragLastX = 0, dragDist = 0, dragVel = 0, dragMoveT = 0;
  let suppressClick = false, dragPointerType = "mouse";
  let lastPointerX = NaN, lastPointerY = NaN, pointerInside = false, lastPointerType = "mouse";
  let hoverPanel = false, hoverFocused = false;

  let cursorNow = "";
  function setCursor(v) { if (v === cursorNow) return; cursorNow = v; el.style.cursor = v; }
  function updateCursor() {
    if (entryActive || entrySettled) return setCursor("");
    if (focusState.active) return setCursor(hoverFocused ? "zoom-in" : "zoom-out");
    if (dragging) return setCursor("grabbing");
    if (!hoverPanel) return setCursor("");
    return setCursor("grab");
  }
  function setHover(on) { hoverPanel = on; updateCursor(); }
  function refreshHover() {
    if (!pointerInside || lastPointerType !== "mouse" || !Number.isFinite(lastPointerX)) return;
    if (focusState.active) {
      const on = panelAtPointer(lastPointerX, lastPointerY);
      hoverFocused = !!on && on.poolIdx === focusState.poolIdx;
      setHover(false);
      return;
    }
    hoverFocused = false;
    setHover(panelAtPointer(lastPointerX, lastPointerY) !== null);
  }

  function inputLocked() { return focusState.active || entryActive || entrySettled; }

  function onWheel(e) {
    e.preventDefault();
    if (inputLocked()) return;
    pendingFocus = null;
    target += (e.deltaY || e.deltaX) * pp.wheelSpeed;
    lastInput = performance.now();
    snapped = false;
  }

  function onPointerDown(e) {
    suppressClick = false;
    readBounds();
    if (inputLocked() || dragging) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragging = true;
    dragPointerId = e.pointerId;
    dragPointerType = e.pointerType || "mouse";
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    dragLastX = e.clientX;
    lastPointerX = e.clientX - bounds.left;
    lastPointerY = e.clientY - bounds.top;
    dragDist = 0;
    dragVel = 0;
    dragMoveT = performance.now();
    updateCursor();
    velocity = 0;
    pendingFocus = null;
    snapped = false;
    lastInput = dragMoveT;
  }

  function onPointerMove(e) {
    if (dragging && e.pointerId === dragPointerId) {
      const sens = dragPointerType === "mouse" ? pp.dragSpeed : pp.touchDrag;
      const dx = e.clientX - dragLastX;
      dragLastX = e.clientX;
      dragDist += Math.abs(dx);
      target -= dx * sens;
      dragVel = dragVel * 0.6 + -dx * sens * 0.4;
      dragMoveT = performance.now();
      lastInput = dragMoveT;
      snapped = false;
    }
    lastPointerX = e.clientX - bounds.left;
    lastPointerY = e.clientY - bounds.top;
    lastPointerType = e.pointerType || "mouse";
    pointerInside = true;
    if (e.pointerType !== "mouse") return;
    if (focusState.active) { setHover(false); return; }
    setHover(panelAtPointer(lastPointerX, lastPointerY) !== null);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    if (e && dragPointerId !== null && e.pointerId !== dragPointerId) return;
    dragging = false;
    if (dragPointerId !== null) {
      try { el.releasePointerCapture(dragPointerId); } catch (err) { /* already released */ }
      dragPointerId = null;
    }
    velocity = performance.now() - dragMoveT > pp.flickIdleMs ? 0 : dragVel;
    dragVel = 0;
    lastInput = performance.now();
    snapped = false;
    suppressClick = dragDist > (dragPointerType === "mouse" ? pp.clickSlop : pp.touchClickSlop);
    if (dragPointerType === "mouse") setHover(panelAtPointer(lastPointerX, lastPointerY) !== null);
    else updateCursor();
  }

  function onEnter(e) { pointerInside = true; lastPointerType = e.pointerType || "mouse"; readBounds(); }
  function onLeave() { pointerInside = false; setHover(false); }

  function onKeyDown(e) {
    if (e.key !== "Escape" || !focusState.active) return;
    if (document.querySelector(".lightbox.is-open")) return;     // Esc closes the lightbox first
    e.preventDefault();
    closeFocus();
  }

  function onClick(e) {
    if (suppressClick) { suppressClick = false; return; }
    const hit = panelAtPointer(e.clientX - bounds.left, e.clientY - bounds.top);
    if (focusState.active) {
      if (hit && hit.poolIdx === focusState.poolIdx) { if (onOpen) onOpen(hit.srcIndex); }
      else closeFocus();
      return;
    }
    if (inputLocked() || !hit) return;
    if (centeredPanel && hit.poolIdx === centeredPanel.poolIdx) {
      pendingFocus = null;
      openFocus();
      return;
    }
    velocity = 0;
    target = centerForIndex(nearestIndex(scroll + hit.centerX));
    snapped = true;
    pendingFocus = { srcIndex: hit.srcIndex };
    updateCursor();
  }

  /* ---- focus: center card grows, the rest drop away ---- */
  function openFocus() {
    if (focusState.active || !centeredPanel) return;
    const F = pp.focus;
    const panel = centeredPanel;
    const src = sources[panel.srcIndex];
    if (!src || !src.tex) return;

    focusState.active = true;
    closing = false;
    focusState.srcIndex = panel.srcIndex;
    focusState.poolIdx = panel.poolIdx;
    target = centerForIndex(nearestIndex(scroll));

    const focusX = lastCenterX[panel.poolIdx] || 0;
    const others = pool
      .map((p, idx) => ({ idx, x: lastCenterX[idx] }))
      .filter((o) => o.idx !== panel.poolIdx && o.x !== undefined)
      .map((o) => ({ idx: o.idx, dist: Math.abs(o.x - focusX) }))
      .sort((a, b) => a.dist - b.dist);
    let rank = 0, prevDist = -1;
    const ranked = others.map((o) => {
      if (prevDist >= 0 && o.dist - prevDist > 1) rank++;
      prevDist = o.dist;
      return { idx: o.idx, rank };
    });

    if (focusTl) focusTl.kill();
    const tl = new Timeline();
    tl.to(focusState, "lensFx", 0, F.lensFade, OUT3, 0);
    tl.to(focusZoom, "v", F.centerScale, F.focusDuration, F.ease, 0);
    ranked.forEach((o) => tl.to(drop, o.idx, 1, F.cardDuration, F.ease, o.rank * F.stagger));
    focusTl = tl;
    updateCursor();
  }

  function closeFocus() {
    if (!focusState.active || closing) return;
    closing = true;
    const F = pp.focus;
    if (focusTl) focusTl.kill();

    const focusX = lastCenterX[focusState.poolIdx] || 0;
    const others = pool
      .map((p, idx) => ({ idx, x: lastCenterX[idx] }))
      .filter((o) => o.x !== undefined && (drop[o.idx] || 0) > 0)
      .map((o) => ({ idx: o.idx, dist: Math.abs(o.x - focusX) }))
      .sort((a, b) => b.dist - a.dist);
    let rank = 0, prevDist = -1;
    const ranked = others.map((o) => {
      if (prevDist >= 0 && prevDist - o.dist > 1) rank++;
      prevDist = o.dist;
      return { idx: o.idx, rank };
    });

    const tl = new Timeline();
    tl.to(focusState, "lensFx", 1, F.lensFade * 0.8, INOUT3, 0);
    tl.to(focusZoom, "v", 1, F.focusDuration * 0.85, F.ease, 0);
    let end = Math.max(F.lensFade * 0.8, F.focusDuration * 0.85);
    ranked.forEach((o) => {
      const at = o.rank * F.stagger * 0.7;
      end = Math.max(end, at + F.cardDuration * 0.85);
      tl.to(drop, o.idx, 0, F.cardDuration * 0.85, F.ease, at);
    });
    tl.call(() => {
      focusState.active = false;
      focusState.srcIndex = -1;
      focusState.poolIdx = -1;
      closing = false;
      updateCursor();
    }, end);
    focusTl = tl;
  }

  /* ---- entry: cards rise in small, then grow from the center out ---- */
  function playEntry() {
    if (!sources.length) return;
    const E = pp.entry;
    if (entryTl) entryTl.kill();
    const N = sources.length;
    for (let k = 0; k < pEntry.length; k++) pEntry[k] = 0;
    for (let k = 0; k < growArr.length; k++) growArr[k] = 0;
    entryActive = true;
    entrySettled = false;
    focusState.lensFx = 0;

    target = centerForIndex(nearestIndex(scroll));
    scroll = target;
    velocity = 0;
    snapped = true;

    layout();
    const visible = [];
    for (let k = 0; k < lastCenterX.length; k++) if (lastCenterX[k] !== undefined) visible.push(k);

    const tl = new Timeline(E.delay);
    // stagger capped at ~10 cards so a big set arrives as fast as the demo's 10
    const spread = E.stagger * clamp(visible.length - 1, 1, 9);
    let lastRiseEnd = 0;
    visible.forEach((idx) => {
      const at = Math.random() * spread;
      lastRiseEnd = Math.max(lastRiseEnd, at + E.riseDuration);
      tl.to(pEntry, idx, 1, E.riseDuration, E.ease, at);
    });
    tl.call(() => { entryActive = false; entrySettled = true; }, lastRiseEnd);

    const cSrcG = centerIndex(scroll);
    const midRepG = Math.floor(REPEATS / 2);
    const growList = [];
    let maxRank = 0;
    for (let k = 0; k < lastCenterX.length; k++) {
      if (lastCenterX[k] === undefined || Math.floor(k / N) !== midRepG) continue;
      let di = (k % N) - cSrcG;
      if (di > N / 2) di -= N;
      if (di < -N / 2) di += N;
      const r = Math.abs(di);
      maxRank = Math.max(maxRank, r);
      growList.push({ idx: k, rank: r });
    }

    const growStart = lastRiseEnd + E.growDelay;
    let growEnd = growStart;
    tl.to(focusState, "lensFx", 1, E.lensBloom, INOUT2, growStart);
    growList.forEach((o) => {
      const rank = (E.outward ? o.rank : maxRank - o.rank) * Math.min(1, 6 / Math.max(1, maxRank));
      const at = growStart + rank * E.growStagger;
      growEnd = Math.max(growEnd, at + E.growDuration);
      tl.to(growArr, o.idx, 1, E.growDuration, EXPO_INOUT, at);
    });
    tl.call(() => {
      entrySettled = false;
      for (let k = 0; k < growArr.length; k++) growArr[k] = 1;
      updateCursor();
    }, growEnd);
    entryTl = tl;
  }

  /* ---- frame loop ---- */
  function step(dt) {
    const now = performance.now();
    const f = clamp(dt * 60, 0.1, 4);
    const lerp = (k) => 1 - Math.pow(1 - clamp01(k), f);

    if (entryTl) entryTl.step(dt);
    if (focusTl) focusTl.step(dt);

    if (!dragging) {
      target += velocity * f;
      velocity *= Math.pow(pp.friction, f);
      if (Math.abs(velocity) < 0.05) velocity = 0;
      if (pp.snap && !snapped && !focusState.active && now - lastInput > pp.snapIdleMs) {
        target = centerForIndex(nearestIndex(scroll));
        snapped = true;
      }
    }

    const base = dragging && dragPointerType !== "mouse" ? pp.touchEase : snapped && !pendingFocus ? pp.snapEase : pp.ease;
    scroll += (target - scroll) * lerp(base);

    const rawSpeed = (scroll - prevScroll) / f;
    prevScroll = scroll;
    const norm = Math.min(1, Math.abs(rawSpeed) / Math.max(1, pp.shrinkSpeed));
    const k = norm > scrollEnergy ? pp.shrinkAttack : pp.shrinkDecay;
    scrollEnergy += (norm - scrollEnergy) * lerp(k);

    syncWindows();
    layout();
    refreshHover();

    if (pendingFocus && !focusState.active && Math.abs(target - scroll) < 0.5) {
      const pf = pendingFocus;
      pendingFocus = null;
      if (centeredPanel && centeredPanel.srcIndex === pf.srcIndex) openFocus();
    }

    syncLens(now);
    if (pp.glassMode === "lens") {
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(lensScene, lensCam);
    } else {
      renderer.setRenderTarget(null);                 // frame mode: cards carry their own glass
      renderer.render(scene, camera);
    }
  }

  let raf = 0;
  let lastT = performance.now();
  function tick(t) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    step(dt);
  }

  function resize() {
    const nw = Math.max(1, mount.clientWidth);
    const nh = Math.max(1, mount.clientHeight);
    if (nw === W && nh === H) return;
    W = nw; H = nh;
    renderer.setSize(W, H);
    camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2;
    camera.updateProjectionMatrix();
    rt.setSize(Math.max(1, Math.round(W * dpr)), Math.max(1, Math.round(H * dpr)));
    lensU.uRes.value.set(W * dpr, H * dpr);
    recomputeTotal();
    if (ready) { target = centerForIndex(nearestIndex(scroll)); scroll = target; }
    readBounds();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(mount);

  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("pointerenter", onEnter);
  el.addEventListener("pointerleave", onLeave);
  el.addEventListener("click", onClick);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("scroll", readBounds, { passive: true });
  window.addEventListener("resize", readBounds);
  raf = requestAnimationFrame(tick);

  function destroy() {
    disposed = true;
    if (bootTimer !== null) clearTimeout(bootTimer);
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", readBounds);
    window.removeEventListener("resize", readBounds);
    if (focusTl) focusTl.kill();
    if (entryTl) entryTl.kill();
    disposeContent();
    rt.dispose();
    lensQuad.geometry.dispose();
    lensMat.dispose();
    renderer.dispose();
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  return { setItems, closeFocus, destroy, isFocused: () => focusState.active };
}
