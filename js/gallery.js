/* ==========================================================================
   Rahul Rajesh — photo grid + lightbox
   --------------------------------------------------------------------------
   Any [data-gallery] block of <button class="gallery__item"><img></button>
   shows as a tidy grid (1, 2, or 3 across, set from how many photos it has).
   Clicking a photo opens it full size, uncropped, in a lightbox with prev /
   next, Esc to close, arrow keys, and swipe on phones.

   Markup:
     <div class="gallery" data-gallery>
       <button class="gallery__item" type="button"><img src alt loading="lazy"></button>
     </div>
   ========================================================================== */
(function () {
  const galleries = document.querySelectorAll("[data-gallery]");
  if (!galleries.length) return;

  /* ---- one shared lightbox ---- */
  const box = document.createElement("div");
  box.className = "lightbox";
  box.hidden = true;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Photo viewer");
  box.innerHTML =
    '<button class="lightbox__btn lightbox__close" type="button" aria-label="Close">×</button>' +
    '<button class="lightbox__btn lightbox__nav lightbox__nav--prev" type="button" aria-label="Previous photo">‹</button>' +
    '<figure class="lightbox__figure"><img class="lightbox__img" alt=""><figcaption class="lightbox__count"></figcaption></figure>' +
    '<button class="lightbox__btn lightbox__nav lightbox__nav--next" type="button" aria-label="Next photo">›</button>';
  document.body.appendChild(box);

  const img = box.querySelector(".lightbox__img");
  const count = box.querySelector(".lightbox__count");
  const closeBtn = box.querySelector(".lightbox__close");
  let items = [], idx = 0, lastFocus = null;

  function show(i) {
    idx = (i + items.length) % items.length;
    img.src = items[idx].src;
    img.alt = items[idx].alt;
    count.textContent = items.length > 1 ? (idx + 1) + " / " + items.length : "";
  }
  function open(list, i) {
    items = list;
    lastFocus = document.activeElement;
    box.classList.toggle("is-single", list.length < 2);
    show(i);
    box.hidden = false;
    requestAnimationFrame(function () { box.classList.add("is-open"); });
    document.body.style.overflow = "hidden";
    closeBtn.focus();
  }
  function close() {
    box.classList.remove("is-open");
    document.body.style.overflow = "";
    window.setTimeout(function () { box.hidden = true; img.removeAttribute("src"); }, 220);
    if (lastFocus) lastFocus.focus();
  }

  closeBtn.addEventListener("click", close);
  box.querySelector(".lightbox__nav--prev").addEventListener("click", function () { show(idx - 1); });
  box.querySelector(".lightbox__nav--next").addEventListener("click", function () { show(idx + 1); });
  box.addEventListener("click", function (e) { if (e.target === box) close(); });   // click the backdrop
  document.addEventListener("keydown", function (e) {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft" && items.length > 1) show(idx - 1);
    else if (e.key === "ArrowRight" && items.length > 1) show(idx + 1);
  });
  let x0 = null;
  box.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener("touchend", function (e) {
    if (x0 === null || items.length < 2) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
    x0 = null;
  });

  /* ---- wire each grid ---- */
  Array.prototype.forEach.call(galleries, function (g) {
    const buttons = Array.prototype.slice.call(g.querySelectorAll(".gallery__item"));
    g.setAttribute("data-count", String(Math.min(buttons.length, 3)));
    const list = buttons.map(function (b) {
      const im = b.querySelector("img");
      return { src: im.getAttribute("src"), alt: im.getAttribute("alt") || "" };
    });
    buttons.forEach(function (b, i) {
      b.setAttribute("aria-label", "Open photo " + (i + 1) + " of " + buttons.length);
      b.addEventListener("click", function () { open(list, i); });
    });
  });
})();
