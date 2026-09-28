/* ==========================================================================
   Rahul Rajesh — photography page
   --------------------------------------------------------------------------
   Reads content/photos.json (written by tools/build_photos.py), fills the
   liquid glass carousel with the small "card" copies, and opens the big
   "full" copy in the shared lightbox (js/gallery.js) when a focused card is
   clicked. The Wildlife / Other pills swap which set the carousel shows.

   If WebGL isn't available, the same photos show as a plain grid instead.
   ========================================================================== */
import { createCarousel } from "./glass-carousel.js";

const mount = document.querySelector("[data-glass]");
const tabs = Array.from(document.querySelectorAll("[data-set]"));
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let sets = {};
let current = null;
let carousel = null;

function fullList(set) {
  return (sets[set] || []).map((p, i) => ({ src: p.full, alt: (set === "wildlife" ? "Wildlife" : "Photo") + " " + (i + 1) }));
}

/* Fallback: the photos as a grid of thumbnails that open the same lightbox */
function showGrid(set) {
  mount.classList.add("glass--grid");
  mount.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "gallery";
  grid.setAttribute("data-count", "3");
  (sets[set] || []).forEach((p, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gallery__item";
    const img = document.createElement("img");
    img.src = p.card;
    img.alt = "Photo " + (i + 1);
    img.loading = "lazy";
    b.appendChild(img);
    b.addEventListener("click", () => window.RRGallery && window.RRGallery.open(fullList(set), i));
    grid.appendChild(b);
  });
  mount.appendChild(grid);
}

function show(set) {
  if (set === current || !sets[set]) return;
  current = set;
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.set === set)));
  if (carousel) carousel.setItems(sets[set].map((p) => ({ src: p.card, aspect: p.w / p.h })));
  else showGrid(set);
}

async function start() {
  try {
    const res = await fetch("content/photos.json?t=" + Date.now());
    sets = await res.json();
  } catch (e) {
    mount.textContent = "Photos couldn't load. Try refreshing.";
    return;
  }
  try {
    carousel = createCarousel(mount, {
      reduceMotion,
      onOpen: (i) => window.RRGallery && window.RRGallery.open(fullList(current), i),
    });
  } catch (e) {
    console.warn("Glass carousel unavailable, showing a grid:", e);
    carousel = null;
  }
  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.set)));
  const hint = document.querySelector(".glass-hint");
  if (hint && !carousel) hint.hidden = true;
  else if (hint && window.matchMedia("(hover: none)").matches) {
    hint.textContent = "Swipe · tap a photo to focus · tap again for full size";
  }
  show(tabs[0] ? tabs[0].dataset.set : "wildlife");
}

start();
