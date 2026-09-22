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

/* ---- A. THEME TOGGLE (lightbulb dark-mode narrative) ---- */
function setHeroVideo(theme) {
  const v = document.getElementById("heroVideo");
  if (!v) return;
  const src = theme === "dark" ? "assets/video/night.mp4" : "assets/video/light.mp4";
  const s = v.querySelector("source");
  if (!s || s.getAttribute("src") === src) return;
  s.setAttribute("src", src);
  v.load();
  const p = v.play();
  if (p && p.catch) p.catch(() => {});
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  try { localStorage.setItem("theme", theme); } catch (e) { /* private mode */ }
  setHeroVideo(theme);
  if (window.RRScene && window.RRScene.refreshTheme) window.RRScene.refreshTheme();
}

let bulbDropped = false;

// Toggles AFTER the bulb has dropped: quick overlay fade + swap. The glow
// follows the theme via CSS, so the hanging bulb just brightens / dims.
function toggleTheme(overlay) {
  const goingDark = document.documentElement.getAttribute("data-theme") !== "dark";
  if (overlay && window.gsap && !reduceMotion) {
    window.gsap.timeline()
      .add(() => overlay.classList.add("active"))
      .to({}, { duration: 0.3 })
      .add(() => applyTheme(goingDark ? "dark" : "light"))
      .to({}, { duration: 0.3 })
      .add(() => overlay.classList.remove("active"))
      .to({}, { duration: 0.3 });
  } else if (overlay) {
    overlay.classList.add("active");
    window.setTimeout(() => applyTheme(goingDark ? "dark" : "light"), 250);
    window.setTimeout(() => overlay.classList.remove("active"), 520);
  } else {
    applyTheme(goingDark ? "dark" : "light");
  }
}

// The one-time animation: screen darkens, the bulb drops ~an inch from the top
// and starts glowing, then STAYS. From here the hanging bulb is the toggle.
function dropBulbToDark(overlay, bulb) {
  bulbDropped = true;
  document.body.classList.add("has-toggled");    // hides the corner moon button
  bulb.classList.add("dropped");
  const anim = overlay && window.gsap && !reduceMotion;
  if (!anim) {
    if (overlay) overlay.classList.add("active");
    applyTheme("dark");
    if (overlay) window.setTimeout(() => overlay.classList.remove("active"), 300);
    return;
  }
  const glass = bulb.querySelector(".bulb-glass");
  overlay.classList.add("active");
  window.gsap.set(bulb, { xPercent: -50, y: -110, opacity: 1 });   // y = drop distance
  bulb.classList.add("dropping");                            // faint unlit outline
  window.gsap.timeline()
    .to({}, { duration: 0.5 })                                 // hold dark
    .to(bulb, { y: 0, duration: 0.7, ease: "bounce.out" })    // short drop
    .to({}, { duration: 0.2 })                                // hang unlit a beat longer
    .add(() => {                                              // then flicker to life
      applyTheme("dark");
      // inline animation wins over the steady-glow rule reliably
      if (glass) glass.style.animation = "bulb-flicker 0.7s linear 1";
    })
    .to({}, { duration: 0.75 })                               // let the full flicker play
    .add(() => {                                              // settle to steady glow
      bulb.classList.remove("dropping");
      if (glass) glass.style.animation = "";                 // hand back to the CSS radiate
    })
    .to({}, { duration: 0.2 })
    .add(() => overlay.classList.remove("active"));           // reveal; bulb stays hanging
}

function initThemeToggle() {
  const toggle = document.querySelector("#theme-toggle");
  if (!toggle) return;

  const overlay = document.getElementById("theme-transition");
  const bulb = document.getElementById("lightbulb");
  // Theme was already applied to <html> by the inline <head> script from
  // localStorage; sync the rest of the UI to match it.
  const startDark = document.documentElement.getAttribute("data-theme") === "dark";
  setHeroVideo(startDark ? "dark" : "light");

  // If we're loading straight into dark (came back from another page, or a
  // reload), skip the one-time drop: the bulb is already hanging + lit.
  if (startDark && bulb) {
    bulbDropped = true;
    document.body.classList.add("has-toggled");
    bulb.classList.add("dropped");
  }

  // Corner moon: only triggers the very first light->dark (then it hides).
  toggle.addEventListener("click", () => {
    if (!bulb) { toggleTheme(overlay); return; } // section pages: simple swap
    if (!bulbDropped) dropBulbToDark(overlay, bulb);
  });

  // Hanging bulb: the persistent toggle once it has dropped.
  if (bulb) {
    const act = () => { if (bulbDropped) toggleTheme(overlay); };
    bulb.addEventListener("click", act);
    bulb.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); }
    });
  }
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

  // Came from a section page (#home flag): don't replay the loader — drop
  // straight onto the loaded home. Reveal the scene without the intro morph.
  if (document.documentElement.classList.contains("skip-loader")) {
    document.body.classList.remove("is-loading");
    preloader.hidden = true;
    return;
  }

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
