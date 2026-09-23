/* ==========================================================================
   Rahul Rajesh — media slider (images + video)
   --------------------------------------------------------------------------
   A tiny dependency-free slideshow for any [data-slider] block. One slide at a
   time; ‹ › arrows, dots, and a counter are built in JS from the slides. Click
   an image to advance; videos keep their own controls (click-to-play). Works
   with keyboard (when focused) and swipe. Videos are paused when you move off
   a slide or close the surrounding dropdown.

   Markup:
     <div class="slider" data-slider>
       <div class="slider__viewport">
         <div class="slider__track">
           <figure class="slider__slide"><img src loading="lazy"></figure>
           <figure class="slider__slide slider__slide--video">
             <video src poster controls preload="none" playsinline></video>
           </figure>
         </div>
       </div>
     </div>
   ========================================================================== */
(function () {
  function mkBtn(cls, label, aria) {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.innerHTML = label;
    b.setAttribute("aria-label", aria);
    return b;
  }

  function setup(root) {
    const viewport = root.querySelector(".slider__viewport");
    const track = root.querySelector(".slider__track");
    const slides = Array.prototype.slice.call(root.querySelectorAll(".slider__slide"));
    if (!viewport || !track || !slides.length) return;
    let idx = 0;

    const prev = mkBtn("slider__arrow slider__arrow--prev", "‹", "Previous");
    const next = mkBtn("slider__arrow slider__arrow--next", "›", "Next");
    const counter = document.createElement("div");
    counter.className = "slider__counter";
    const dots = document.createElement("div");
    dots.className = "slider__dots";
    const dotEls = slides.map(function (_, i) {
      const d = document.createElement("button");
      d.type = "button"; d.className = "slider__dot";
      d.setAttribute("aria-label", "Go to slide " + (i + 1));
      d.addEventListener("click", function () { go(i); });
      dots.appendChild(d);
      return d;
    });

    viewport.appendChild(prev);
    viewport.appendChild(next);
    viewport.appendChild(counter);
    root.appendChild(dots);

    prev.addEventListener("click", function (e) { e.stopPropagation(); go(idx - 1); });
    next.addEventListener("click", function (e) { e.stopPropagation(); go(idx + 1); });

    // Click an image slide to advance; a video slide keeps its own controls.
    slides.forEach(function (s) {
      if (!s.querySelector("video")) {
        s.classList.add("is-clickable");
        s.addEventListener("click", function () { go(idx + 1); });
      }
    });

    // Keyboard (when the viewport is focused)
    viewport.tabIndex = 0;
    viewport.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(idx + 1); }
    });

    // Swipe
    let x0 = null;
    viewport.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    viewport.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1));
      x0 = null;
    });

    // Pause videos when the enclosing dropdown is closed
    const details = root.closest("details");
    if (details) details.addEventListener("toggle", function () { if (!details.open) pauseAll(); });

    function pauseAll() {
      slides.forEach(function (s) { const v = s.querySelector("video"); if (v) v.pause(); });
    }

    function go(i) {
      const n = slides.length;
      idx = ((i % n) + n) % n;
      track.style.transform = "translateX(" + (-idx * 100) + "%)";
      dotEls.forEach(function (d, k) { d.classList.toggle("is-active", k === idx); });
      counter.textContent = (idx + 1) + " / " + n;
      slides.forEach(function (s, k) { const v = s.querySelector("video"); if (v && k !== idx) v.pause(); });
    }

    if (slides.length < 2) {
      prev.style.display = "none"; next.style.display = "none"; dots.style.display = "none";
    }
    go(0);
  }

  const sliders = document.querySelectorAll("[data-slider]");
  Array.prototype.forEach.call(sliders, setup);
})();
