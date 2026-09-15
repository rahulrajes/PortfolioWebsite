/* ==========================================================================
   Rahul Rajesh — WebGL scene (Layer 4)
   --------------------------------------------------------------------------
   A THIN curved image "drum": five short panels wrapped around a cylinder,
   one per section. Rotation is driven by page scroll (see js/main.js, which
   calls setProgress on each scroll tick); the dock arrows and reduced-motion
   fallback use rotateTo instead. Panels carry only a faint index number now —
   the section NAME is crisp HTML in the page (js/main.js), so it never warps
   on the curve. There is no mirrored reflection anymore; a soft CSS floor
   sheen (.floor-sheen) grounds the band instead.

   Exposes window.RRScene = { rotateTo, setProgress, reveal, refreshTheme } so
   js/main.js can drive it. Everything here is optional: if WebGL or Three
   fails, main.js still runs the page fine.
   ========================================================================== */

import * as THREE from "three";

const SECTIONS = window.RR_SECTIONS || [];
const canvas = document.querySelector("#scene");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Panel colors (theme-independent so they read on both light + dark backgrounds)
const PANEL_TOP = "#1c3a5a";
const PANEL_BOTTOM = "#0d1b2a";

const N = SECTIONS.length;
const R = 3.15;                     // drum radius
const H = 1.05;                     // panel height — a thin band, not a tall drum
const SEG = (Math.PI * 2) / N;      // arc per panel

let renderer, scene, camera, drum;
let ready = false;
let revealed = false;
let currentY = 0;                   // current drum rotation (radians)
let pendingIndex = 0;

if (canvas && N > 0) {
  try { init(); } catch (e) { console.warn("WebGL scene disabled:", e); }
}

/* -------- draw a placeholder texture for one panel (index number only) --------
   The section name used to live here and warped on the curve; it's now crisp
   HTML in the page. A short 2-digit index tolerates the arc fine. -------- */
function makeTexture(index) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 384;                 // wide + short, matching the thin band
  const ctx = c.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, PANEL_TOP); g.addColorStop(1, PANEL_BOTTOM);
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);

  // large, faint index number centered on the panel
  ctx.fillStyle = "rgba(240,235,225,0.16)";
  ctx.font = '600 220px "Schibsted Grotesk", sans-serif';
  ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.fillText(String(index + 1).padStart(2, "0"), c.width / 2, c.height / 2 + 6);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* -------- build one curved panel (a cylinder segment) -------- */
function makePanel(i) {
  const geo = new THREE.CylinderGeometry(R, R, H, 48, 1, true, i * SEG, SEG);
  const mat = new THREE.MeshBasicMaterial({
    map: makeTexture(i),
    side: THREE.DoubleSide,
    transparent: true,
  });
  return new THREE.Mesh(geo, mat);
}

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  // Build the drum once fonts are ready (so the index digits use the real font)
  const build = () => {
    drum = new THREE.Group();
    for (let i = 0; i < N; i++) drum.add(makePanel(i));
    scene.add(drum);
    ready = true;
    rotateTo(pendingIndex, true);         // snap to the active section
    if (revealed) playReveal();
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
  else build();

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(tick);
}

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // pull the camera back on tall/narrow (portrait) screens so the drum fits
  camera.position.z = camera.aspect < 1 ? 12.5 : 9;
  camera.updateProjectionMatrix();
}

/* -------- angle that brings panel i to the front (+Z) -------- */
function angleFor(i) { return -(i * SEG + SEG / 2); }

/* -------- rotate the drum so panel i faces the camera (shortest path) --------
   Used by the dock arrows / keyboard and by the reduced-motion fallback. When
   scroll drives the scene, setProgress is used instead. -------- */
function rotateTo(i, immediate) {
  pendingIndex = i;
  if (!ready) return;
  const base = angleFor(i);
  const twoPi = Math.PI * 2;
  let diff = ((base - currentY) % twoPi + twoPi) % twoPi;
  if (diff > Math.PI) diff -= twoPi;      // choose the shorter direction
  const target = currentY + diff;
  currentY = target;

  if (immediate || reduce || !window.gsap) {
    drum.rotation.y = target;
  } else {
    window.gsap.to(drum.rotation, { y: target, duration: 1.0, ease: "power3.inOut" });
  }
}

/* -------- scroll-driven rotation --------
   progress 0..1 maps linearly across the N panels: p=0 -> panel 0 at front,
   p=1 -> the last panel at front. ScrollTrigger's scrub already smooths this,
   so we set the rotation directly (no tween). -------- */
function setProgress(p) {
  const clamped = Math.max(0, Math.min(1, p));
  pendingIndex = Math.round(clamped * (N - 1));
  if (!ready) return;
  const target = -(SEG / 2) - clamped * (N - 1) * SEG;
  currentY = target;
  drum.rotation.y = target;
}

/* -------- intro reveal (called by the loader once it hits 100%) -------- */
function reveal() { revealed = true; if (ready) playReveal(); }
function playReveal() {
  if (reduce || !window.gsap || !drum) return;
  window.gsap.from(drum.scale, { x: 0.8, y: 0.8, z: 0.8, duration: 1.2, ease: "power3.out" });
  window.gsap.from(camera.position, { z: camera.position.z + 2.5, duration: 1.3, ease: "power3.out",
    onUpdate: () => camera.updateProjectionMatrix() });
}

function refreshTheme() { /* panels are theme-independent for now; hook kept for later */ }

function tick(t) {
  requestAnimationFrame(tick);
  if (ready && !reduce) {
    drum.position.y = Math.sin(t * 0.0006) * 0.05;   // gentle idle float
  }
  if (renderer) renderer.render(scene, camera);
}

window.RRScene = { rotateTo, setProgress, reveal, refreshTheme };
