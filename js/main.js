/* ==========================================================================
   Rahul Rajesh — site behavior (Layer 4)
     A. Theme toggle       (every page)
     B. Preloader          (ring + count, then reveal)        — landing only
     C. Scroll rotation    (scroll drives the drum, w/ snap)  — landing only
     D. Nav / dock         (label + title + arrows + open)    — landing only

   The WebGL drum lives in js/scene.js and exposes window.RRScene. This file
   degrades gracefully: if the scene never loads (or motion is reduced), the
   loader, reveal, dock, and keyboard nav still work.
   ========================================================================== */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const S = window.RR_SECTIONS || [];
const N = S.length;
let current = 0;                       // active section index, shared across B–D

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
  window.setTimeout(() => {
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
    // morph (stretch wide + rise to the top).
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

/* ---- C. SCROLL ROTATION (ScrollTrigger scrub + snap) ----
   Maps page-scroll progress to the drum's rotation and snaps so a section
   always lands centered. Returns true when active (motion enabled). -------- */
function initScrollRotation() {
  if (reduceMotion || !window.gsap || !window.ScrollTrigger || N < 2) return false;
  document.body.classList.add("motion-ok");
  window.gsap.registerPlugin(window.ScrollTrigger);

  window.ScrollTrigger.create({
    trigger: "#scrollTrack", start: "top top", end: "bottom bottom", scrub: 1,
    snap: { snapTo: 1 / (N - 1), duration: { min: 0.15, max: 0.45 }, ease: "power2.inOut" },
    onUpdate: (self) => {
      if (window.RRScene && window.RRScene.setProgress) window.RRScene.setProgress(self.progress);
      setActive(Math.round(self.progress * (N - 1)));
    },
  });

  // Layout depends on font metrics + the fixed stage; recalc once both settle.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => window.ScrollTrigger.refresh());
  window.addEventListener("load", () => window.ScrollTrigger.refresh());

  // Retire the "scroll to explore" hint after the first real scroll.
  const hint = document.querySelector("#scrollHint");
  if (hint) window.addEventListener("scroll", () => hint.classList.add("is-hidden"), { once: true, passive: true });
  return true;
}

/* ---- D. NAV / DOCK ---- */
function initDock() {
  if (!S.length) return;
  const prev = document.querySelector("#prevBtn");
  const next = document.querySelector("#nextBtn");
  const enter = document.querySelector("#enterBtn");
  const view = document.querySelector("#viewBtn");
  const label = document.querySelector("#dockLabel");
  const thumb = document.querySelector("#dockThumb");
  const motionOn = document.body.classList.contains("motion-ok");

  function open() { window.location.href = S[current].href; }

  // When scroll drives the scene, move the scrollbar to the target section and
  // let onUpdate rotate + relabel. Otherwise rotate the drum directly.
  function scrollToIndex(i) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: (i / (N - 1)) * max, behavior: reduceMotion ? "auto" : "smooth" });
  }
  function navigate(dir) {
    const target = Math.max(0, Math.min(N - 1, current + dir));
    if (target === current) return;
    if (motionOn) { scrollToIndex(target); }
    else { setActive(target); if (window.RRScene && window.RRScene.rotateTo) window.RRScene.rotateTo(target); }
  }

  if (prev) prev.addEventListener("click", () => navigate(-1));
  if (next) next.addEventListener("click", () => navigate(1));
  if (enter) enter.addEventListener("click", open);
  if (view) view.addEventListener("click", open);
  if (label) label.addEventListener("click", open);
  if (thumb) thumb.addEventListener("click", open);

  // Keyboard: Left/Right step sections (vertical keys stay native scroll).
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") navigate(1);
    else if (e.key === "ArrowLeft") navigate(-1);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  initPreloader();
  initScrollRotation();   // sets body.motion-ok when active
  initDock();             // reads body.motion-ok
});
