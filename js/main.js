/* ==========================================================================
   Rahul Rajesh — site behavior (Layer 5)
     A. Theme toggle       (every page)
     B. Preloader          (ring + count, then reveal)          — landing only
     C. Spin               (scroll/drag -> infinite rotation)   — landing only
     D. Nav / dock         (label + title + arrows + open)      — landing only
     E. Curved wordmark     (per-letter 3D on the drum's rim)   — landing only

   The WebGL drum lives in js/scene.js and exposes window.RRScene. This file
   degrades gracefully: if the scene never loads (or motion is reduced), the
   loader, reveal, dock, and keyboard nav still work.
   ========================================================================== */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const S = window.RR_SECTIONS || [];
const N = S.length;
let current = 0;                       // active section index, shared across B–E
let swapTimer = null;

/* ---- A. THEME TOGGLE ---- */
function initThemeToggle() {
  const root = document.documentElement;
  const toggle = document.querySelector("#theme-toggle");
  if (!toggle) return;
  if (localStorage.getItem("theme") === "dark") root.setAttribute("data-theme", "dark");
  toggle.addEventListener("click", () => {
    const isDark = root.getAttribute("data-theme") === "dark";
    if (isDark) { root.removeAttribute("data-theme"); localStorage.setItem("theme", "light"); }
    else        { root.setAttribute("data-theme", "dark"); localStorage.setItem("theme", "dark"); }
    if (window.RRScene && window.RRScene.refreshTheme) window.RRScene.refreshTheme();
  });
}

/* ---- Shared: reflect the active section in the dock + centered title ---- */
function setActive(i) {
  i = ((i % N) + N) % N;
  if (i === current) return;
  current = i;
  const label = document.querySelector("#dockLabel");
  const thumb = document.querySelector("#dockThumb");
  const title = document.querySelector("#sectionTitle");
  const swap = [label, title].filter(Boolean);
  swap.forEach((el) => el.classList.add("is-swapping"));
  if (swapTimer) clearTimeout(swapTimer);
  swapTimer = window.setTimeout(() => {
    if (label) label.textContent = S[i].label;
    if (title) title.textContent = S[i].label;
    if (thumb) thumb.textContent = String(i + 1).padStart(2, "0");
    swap.forEach((el) => el.classList.remove("is-swapping"));
  }, reduceMotion ? 0 : 180);
}

/* ---- B. PRELOADER (ring + count) ---- */
function initPreloader() {
  const preloader = document.querySelector("#preloader");
  const bar = document.querySelector("#loaderBar");
  const pctEl = document.querySelector("#pct");
  if (!preloader || !pctEl) return;

  const CIRC = 2 * Math.PI * 54;           // circumference of the ring (r = 54)
  function setPct(p) {
    pctEl.textContent = p;
    if (bar) bar.style.strokeDashoffset = CIRC * (1 - p / 100);   // fill the ring
  }

  function reveal() {
    // Removing is-loading fades the stage/dock in AND triggers the CSS wordmark
    // morph (rise + curve onto the drum's top rim).
    document.body.classList.remove("is-loading");
    if (window.RRScene && window.RRScene.reveal) window.RRScene.reveal();
    if (window.gsap) {
      window.gsap.to(preloader, { opacity: 0, duration: 0.7, ease: "power2.out",
        onComplete: () => { preloader.hidden = true; } });
    } else {
      preloader.style.transition = "opacity 700ms ease";
      preloader.style.opacity = "0";
      window.setTimeout(() => { preloader.hidden = true; }, 720);
    }
  }

  if (reduceMotion) { setPct(100); reveal(); return; }

  let pct = 0, loaded = false;
  window.addEventListener("load", () => { loaded = true; });
  const timer = window.setInterval(() => {
    const target = loaded ? 100 : 90;      // hold at 90 until the page truly loads
    pct += Math.max(1, Math.round((target - pct) * 0.08));
    if (pct >= target) pct = target;
    setPct(pct);
    if (pct >= 100) { window.clearInterval(timer); window.setTimeout(reveal, 350); }
  }, 55);
}

/* ---- C. SPIN (scroll / trackpad / drag -> infinite rotation) ----
   Feeds input deltas into RRScene.spin() (unbounded, so it never hits a stop),
   and calls settle() shortly after input stops so a section lands centered.
   Returns true when active (motion enabled). -------- */
function hideHint() {
  const hint = document.querySelector("#scrollHint");
  if (hint) hint.classList.add("is-hidden");
}
function initSpin() {
  if (reduceMotion || !window.RRScene || !window.RRScene.spin || N < 2) return false;
  document.body.classList.add("motion-ok");
  window.RRScene.onActiveChange = setActive;

  const K = 0.0016;                 // wheel pixels -> radians
  let settleTimer = null;
  function afterInput() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => window.RRScene.settle(), 150);
  }

  // wheel / trackpad — hijack page scroll to spin the drum (single-screen landing)
  window.addEventListener("wheel", (e) => {
    e.preventDefault();
    window.RRScene.spin(-e.deltaY * K);   // scroll down -> advance forward through sections
    afterInput();
    hideHint();
  }, { passive: false });

  // touch drag to spin
  let lastY = null;
  window.addEventListener("touchstart", (e) => { lastY = e.touches[0].clientY; hideHint(); }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (lastY == null) return;
    const y = e.touches[0].clientY;
    window.RRScene.spin(-(lastY - y) * K * 3.5);
    lastY = y;
    afterInput();
  }, { passive: true });
  window.addEventListener("touchend", () => { lastY = null; if (window.RRScene) window.RRScene.settle(); });

  return true;
}

/* ---- D. NAV / DOCK ---- */
function initDock() {
  if (!S.length) return;
  const prev = document.querySelector("#prevBtn");
  const next = document.querySelector("#nextBtn");
  const enter = document.querySelector("#enterBtn");
  const view = document.querySelector("#viewBtn");
  const motionOn = document.body.classList.contains("motion-ok");

  function open() { window.location.href = S[current].href; }
  function navigate(dir) {
    const target = ((current + dir) % N + N) % N;
    if (window.RRScene && window.RRScene.rotateTo) window.RRScene.rotateTo(target, !motionOn);
    if (!motionOn) setActive(target);     // reduced-motion has no onActiveChange hook
  }

  if (prev) prev.addEventListener("click", () => navigate(-1));
  if (next) next.addEventListener("click", () => navigate(1));
  if (enter) enter.addEventListener("click", open);
  if (view) view.addEventListener("click", open);
  const label = document.querySelector("#dockLabel");
  const thumb = document.querySelector("#dockThumb");
  if (label) label.addEventListener("click", open);
  if (thumb) thumb.addEventListener("click", open);

  // Keyboard: Left/Right step sections.
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") navigate(1);
    else if (e.key === "ArrowLeft") navigate(-1);
  });
}

/* ---- E. CURVED WORDMARK (per-letter 3D, sitting on the drum's top curve) ----
   Places each letter on a shallow cylinder: middle letters face front, the ends
   rotate + recede outward. Tunable; adjust STEP/RADIUS to match the drum. ---- */
function curveWordmark() {
  const wrap = document.querySelector(".wordmark__curve");
  if (!wrap) return;
  const chars = Array.prototype.slice.call(wrap.querySelectorAll(".ch"));
  if (!chars.length) return;

  const RADIUS = window.innerWidth < 640 ? 220 : 340;   // px — arc radius
  const STEP = 8;                                       // degrees per width-unit
  const OFFSETS = {
    "R": 0,
    ".": 0,
    "a": 0,
    "ȷ": -10,
    "e": -22,
    "s": -25,
    "h": -27
};

  // proportional widths so the spacing reads naturally (space + period are narrower)
  const unit = (ch) => ch.classList.contains("ch--sp") ? 0.55 : (ch.textContent === "." ? 0.4 : 1);
  const widths = chars.map(unit);
  const total = widths.reduce((a, b) => a + b, 0);

  wrap.style.position = "relative";
  let acc = 0;
  chars.forEach((ch, i) => {
    const centerUnit = acc + widths[i] / 2;
    acc += widths[i];
    const theta = (centerUnit - total / 2) * STEP;     // angle of this letter on the cylinde
    // fan every letter out from a shared axis: same origin, rotate, then push out
    ch.style.position = "absolute";
    ch.style.left = "50%";
    ch.style.top = "50%";
    const xOffset = OFFSETS[ch.textContent] ?? 0;

ch.style.transform =
    `translate(calc(-50% + ${xOffset}px), -50%)
     rotateY(${theta}deg)
     translateZ(${RADIUS}px)`;
  });

  // pull the whole arc back so the front letter sits near z=0, and tilt it as if
  // the name were lying on the drum's top surface
  wrap.style.transform = `translateZ(${-RADIUS}px) rotateX(7deg)`;
}

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  initPreloader();
  curveWordmark();
  initSpin();             // sets body.motion-ok when active
  initDock();             // reads body.motion-ok
  window.addEventListener("resize", curveWordmark);
});
