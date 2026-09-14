/* ==========================================================================
   Rahul Rajesh — site behavior
   --------------------------------------------------------------------------
   Three small features, each in its own clearly-labeled block:
     A. Light / dark theme toggle  (remembers your choice)
     B. Rotating subtitle          (student -> researcher -> photographer ...)
     C. Scroll-reveal              (sections fade in as you scroll)

   Everything runs after the page's HTML is ready (see the DOMContentLoaded
   listener at the very bottom).
   ========================================================================== */


/* --------------------------------------------------------------------------
   A. THEME TOGGLE
   The theme is controlled by a data-theme="dark" attribute on <html>.
   CSS reacts to that attribute (see styles.css section 2). Here we just
   flip it, and remember the choice in localStorage so it sticks next visit.

   NOTE: the light/dark "reading light" video transition (Rahul's clip) will
   hook in here later — right where the comment marks it.
   -------------------------------------------------------------------------- */
function initThemeToggle() {
  const root = document.documentElement;            // the <html> element
  const toggle = document.querySelector("#theme-toggle");
  if (!toggle) return;

  // Decide the starting theme: saved choice wins; otherwise default = light.
  const saved = localStorage.getItem("theme");
  if (saved === "dark") root.setAttribute("data-theme", "dark");

  // Keep the button's icon + label in sync with the current theme.
  function syncButton() {
    const isDark = root.getAttribute("data-theme") === "dark";
    toggle.textContent = isDark ? "☀" : "☾";        // sun in dark mode, moon in light
    toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  }
  syncButton();

  toggle.addEventListener("click", () => {
    const isDark = root.getAttribute("data-theme") === "dark";

    // >>> FUTURE: play Rahul's "reading light" clip here as the transition <<<

    if (isDark) {
      root.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    } else {
      root.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    }
    syncButton();
  });
}


/* --------------------------------------------------------------------------
   B. ROTATING SUBTITLE
   Cycles the word inside <span class="rotator"> through a list, fading each
   in and out. Purely decorative, so if the element isn't on the page we skip.
   -------------------------------------------------------------------------- */
function initRotator() {
  const el = document.querySelector(".rotator");
  if (!el) return;

  const words = ["student", "researcher", "photographer", "artist", "analyst"];
  let i = 0;

  // If the visitor prefers reduced motion, just show the first word, no cycling.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) { el.textContent = words[0]; return; }

  setInterval(() => {
    el.style.opacity = "0";                 // fade out
    setTimeout(() => {
      i = (i + 1) % words.length;           // next word (loops back to start)
      el.textContent = words[i];
      el.style.opacity = "1";               // fade in
    }, 250);
  }, 2200);

  el.style.transition = "opacity 250ms ease";
}


/* --------------------------------------------------------------------------
   C. SCROLL REVEAL
   IntersectionObserver tells us when an element enters the screen. When a
   .reveal element does, we add .is-visible and CSS animates it in (once).
   -------------------------------------------------------------------------- */
function initScrollReveal() {
  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);   // reveal each element only once
      }
    });
  }, { threshold: 0.15 });                   // fire when ~15% is on screen

  items.forEach((item) => observer.observe(item));
}


/* --------------------------------------------------------------------------
   Run everything once the page's HTML has loaded.
   -------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  initRotator();
  initScrollReveal();
});
