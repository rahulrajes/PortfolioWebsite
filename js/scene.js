/* ==========================================================================
   Rahul Rajesh — WebGL scene (Layer 5)
   --------------------------------------------------------------------------
   A tall, segmented curved "drum": six panels wrapped around a cylinder, one
   per section, with gaps + a dark inner core so it reads as a rotatable object.
   Rotation is CONTINUOUS and infinite: js/main.js feeds scroll/drag deltas into
   spin(), and settle() eases to the nearest section when input stops. The drum
   never hits a stop or reverses at an "end" — it just keeps turning.

   The section NAME shows as crisp HTML in the page (js/main.js); panels carry
   only a faint index number. Rahul's name is a separate CSS-3D masthead that
   sits on the drum's top rim (also in the page, not here).

   Exposes window.RRScene = { spin, settle, rotateTo, reveal, refreshTheme,
   onActiveChange, SEG }. Everything is optional: if WebGL/Three fails, main.js
   still runs the page fine.
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
const H = 1.9;                      // panel height — a taller band now
const SEG = (Math.PI * 2) / N;      // arc per panel
const GAP_ANGLE = SEG * 0.08;       // gap between panels so it reads as a segmented drum
const CORE_R = R * 0.9;             // dark inner core, seen through the gaps as a recessed shadow
const EASE = 0.12;                  // how quickly currentY chases targetY each frame

let renderer, scene, camera, drum;
let ready = false;
let revealed = false;
let currentY = angleFor(0);         // eased rotation actually applied to the drum
let targetY = currentY;             // goal rotation (spin/settle move this)
let lastActive = 0;

if (canvas && N > 0) {
  try { init(); } catch (e) { console.warn("WebGL scene disabled:", e); }
}

const SCRIM = "rgba(13, 27, 42, 0.45)";   // navy wash over photos so the title stays readable

/* darken the left/right edges so each panel reads as a curved facet (the haze) */
function drawEdges(ctx, c) {
  const hg = ctx.createLinearGradient(0, 0, c.width, 0);
  hg.addColorStop(0, "rgba(0,0,0,0.55)");
  hg.addColorStop(0.14, "rgba(0,0,0,0)");
  hg.addColorStop(0.86, "rgba(0,0,0,0)");
  hg.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = hg; ctx.fillRect(0, 0, c.width, c.height);
}

/* -------- panel texture: a navy placeholder that swaps to the section photo --------
   Returns immediately with the navy base (also the fallback if the image fails);
   the photo is drawn in on load (cover-cropped) + a navy scrim + the edge haze. */
function makeTexture(index, imgSrc) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 640;
  const ctx = c.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, PANEL_TOP); g.addColorStop(1, PANEL_BOTTOM);
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  drawEdges(ctx, c);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  if (imgSrc) {
    const img = new Image();
    img.onload = () => {
      const scale = Math.max(c.width / img.width, c.height / img.height);   // cover-fit
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
      ctx.fillStyle = SCRIM; ctx.fillRect(0, 0, c.width, c.height);          // readability wash
      drawEdges(ctx, c);
      tex.needsUpdate = true;
    };
    img.onerror = () => { /* keep the navy fallback */ };
    img.src = imgSrc;
  }
  return tex;
}

/* -------- one curved panel (a cylinder segment), trimmed by GAP_ANGLE -------- */
function makePanel(i) {
  const geo = new THREE.CylinderGeometry(
    R, R, H, 48, 1, true, i * SEG + GAP_ANGLE / 2, SEG - GAP_ANGLE
  );
  const mat = new THREE.MeshBasicMaterial({ map: makeTexture(i, SECTIONS[i] && SECTIONS[i].img), side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

/* -------- dark inner core seen through the gaps as recessed shadow/depth -------- */
function makeCore() {
  const geo = new THREE.CylinderGeometry(CORE_R, CORE_R, H, 64, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color: 0x070e18, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const build = () => {
    drum = new THREE.Group();
    drum.add(makeCore());
    for (let i = 0; i < N; i++) drum.add(makePanel(i));
    drum.rotation.y = currentY;
    scene.add(drum);
    ready = true;
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
  // pull the camera back on tall/narrow (portrait) screens so the taller drum fits
  camera.position.z = camera.aspect < 1 ? 13.5 : 10;
  camera.updateProjectionMatrix();
}

/* -------- section-center angle math -------- */
function angleFor(i) { return -(SEG / 2) - i * SEG; }         // brings panel i to the front (+Z)
function nearestSnap(y) {                                     // closest section-center angle to y
  const m = Math.round(-(y + SEG / 2) / SEG);
  return -(SEG / 2) - m * SEG;
}
function activeIndex(y) {                                     // which section is front-most at rotation y
  const m = Math.round(-(y + SEG / 2) / SEG);
  return ((m % N) + N) % N;
}

/* -------- continuous, infinite rotation API -------- */
function spin(delta) { targetY += delta; }                    // unbounded → never stops or reverses at an end
function settle() { targetY = nearestSnap(targetY); }         // ease to the nearest section

/* -------- jump to a specific section (dock arrows / keyboard / reduced-motion) -------- */
function rotateTo(i, immediate) {
  const twoPi = Math.PI * 2;
  const base = angleFor(i);
  let diff = ((base - targetY) % twoPi + twoPi) % twoPi;
  if (diff > Math.PI) diff -= twoPi;                          // shortest direction
  targetY += diff;
  if (immediate || reduce || !ready) { currentY = targetY; if (drum) drum.rotation.y = currentY; }
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

function tick() {
  requestAnimationFrame(tick);
  if (ready) {
    currentY += (targetY - currentY) * EASE;
    if (Math.abs(targetY - currentY) < 1e-4) currentY = targetY;
    drum.rotation.y = currentY;

    const idx = activeIndex(currentY);
    if (idx !== lastActive) {
      lastActive = idx;
      if (typeof api.onActiveChange === "function") api.onActiveChange(idx);
    }
  }
  if (renderer) renderer.render(scene, camera);
}

const api = { spin, settle, rotateTo, reveal, refreshTheme, onActiveChange: null, SEG };
window.RRScene = api;
