/* ==========================================================================
   Rahul Rajesh — photo slideshow (Blog + Journey posts)
   --------------------------------------------------------------------------
   One big photo at a time, at its own shape (nothing cropped). Changing
   photos slides the current one away with a little depth (it shrinks and
   fades) while the next glides in from the side you're heading toward.

     - arrows on the sides, dots + "2 / 5" counter underneath
     - drag / swipe: the photo follows your finger, then snaps to the next
       one or springs back
     - Left / Right arrow keys once the slideshow has focus
     - click / tap a photo: opens it full size in the lightbox (js/gallery.js)
     - the frame's height eases to fit each photo; tall portraits are capped
       so they never run off-screen

   Used by js/posts.js:  RRSlideshow.create(["a.jpg", "b.jpg"], "Post title")
   ========================================================================== */
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var MAX_H = function () { return Math.min(window.innerHeight * 0.72, 680); };   // tallest a photo may be
  var SWIPE = 60;                                                                  // px drag to change photo

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  function create(images, title) {
    var n = images.length, cur = 0, busy = false;
    var root = el("div", "slides" + (n < 2 ? " slides--single" : ""));
    root.tabIndex = 0;
    root.setAttribute("role", "region");
    root.setAttribute("aria-roledescription", "slideshow");
    root.setAttribute("aria-label", (title ? title + " photos" : "Photos"));

    var stage = el("div", "slides__stage");
    var slides = images.map(function (src, i) {
      var s = el("figure", "slides__slide" + (i === 0 ? " is-current" : ""));
      var img = el("img", "slides__img");
      img.alt = (title || "Photo") + " (" + (i + 1) + " of " + n + ")";
      img.draggable = false;
      if (i < 2) img.src = src;                      // first two now, the rest just before they're shown
      img.dataset.src = src;
      img.addEventListener("load", function () { if (i === cur) fit(); });
      s.appendChild(img);
      stage.appendChild(s);
      return s;
    });
    root.appendChild(stage);

    var prev, next, dots = [], count;
    if (n > 1) {
      prev = el("button", "slides__nav slides__nav--prev", "&lsaquo;"); prev.type = "button"; prev.setAttribute("aria-label", "Previous photo");
      next = el("button", "slides__nav slides__nav--next", "&rsaquo;"); next.type = "button"; next.setAttribute("aria-label", "Next photo");
      stage.appendChild(prev); stage.appendChild(next);
      var bar = el("div", "slides__bar");
      var dotWrap = el("div", "slides__dots");
      images.forEach(function (_, i) {
        var d = el("button", "slides__dot" + (i === 0 ? " is-on" : "")); d.type = "button";
        d.setAttribute("aria-label", "Photo " + (i + 1));
        d.addEventListener("click", function () { go(i); });
        dotWrap.appendChild(d); dots.push(d);
      });
      count = el("span", "slides__count");
      bar.appendChild(dotWrap); bar.appendChild(count);
      root.appendChild(bar);
      prev.addEventListener("click", function () { go(cur - 1); });
      next.addEventListener("click", function () { go(cur + 1); });
    }

    function load(i) {
      var img = slides[(i + n) % n].querySelector("img");
      if (!img.getAttribute("src")) img.src = img.dataset.src;
    }

    // frame height = the current photo's height at full width, capped
    function fit() {
      var img = slides[cur].querySelector("img");
      var w = stage.clientWidth;
      if (!w) return;
      var ratio = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 2 / 3;
      var h = Math.round(Math.min(w * ratio, MAX_H()));
      stage.style.height = h + "px";
      slides.forEach(function (s) { s.querySelector("img").style.maxHeight = h + "px"; });
    }

    function status() {
      if (n < 2) return;
      dots.forEach(function (d, i) { d.classList.toggle("is-on", i === cur); });
      count.textContent = (cur + 1) + " / " + n;
    }

    function go(to, fromDrag) {
      if (n < 2 || busy) return;
      var target = ((to % n) + n) % n;
      if (target === cur) return;
      var dir = to > cur ? 1 : -1;                   // wrapping past the end still slides forward
      if (to < 0) dir = -1; else if (to >= n) dir = 1;
      var out = slides[cur], inn = slides[target];
      load(target); load(target + dir);

      busy = true;
      inn.classList.remove("is-current", "is-out-left", "is-out-right");
      inn.classList.add(dir > 0 ? "is-in-right" : "is-in-left");      // park it just off to the side
      inn.style.transform = "";
      void inn.offsetWidth;                                           // commit the parked position
      out.style.transform = "";
      out.classList.remove("is-current", "is-dragging");
      out.classList.add(dir > 0 ? "is-out-left" : "is-out-right");
      inn.classList.remove("is-in-right", "is-in-left");
      inn.classList.add("is-current");
      cur = target;
      fit(); status();
      window.setTimeout(function () {
        out.classList.remove("is-out-left", "is-out-right");
        busy = false;
      }, reduce ? 0 : 620);
    }

    /* ---- drag / swipe: the photo follows the pointer ---- */
    var startX = null, dx = 0, moved = false;
    stage.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".slides__nav") || busy) return;
      startX = e.clientX; dx = 0; moved = false;
      if (n > 1) slides[cur].classList.add("is-dragging");
    });
    window.addEventListener("pointermove", function (e) {
      if (startX === null || n < 2) return;
      dx = e.clientX - startX;
      if (Math.abs(dx) > 6) moved = true;
      var s = slides[cur];
      s.style.transform = "translateX(" + dx + "px) rotate(" + (dx / 60) + "deg)";
    });
    function release() {
      if (startX === null) return;
      var s = slides[cur];
      startX = null;
      s.classList.remove("is-dragging");
      if (moved && Math.abs(dx) > SWIPE) go(dx < 0 ? cur + 1 : cur - 1, true);
      else s.style.transform = "";                                     // spring back
    }
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);                 // e.g. the page started scrolling
    // click without dragging: full size in the lightbox
    stage.addEventListener("click", function (e) {
      if (moved || e.target.closest(".slides__nav")) return;
      if (!e.target.closest(".slides__img") || !window.RRGallery) return;
      window.RRGallery.open(images.map(function (src, i) {
        return { src: src, alt: (title || "Photo") + " " + (i + 1) };
      }), cur);
    });

    root.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); go(cur + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(cur - 1); }
    });

    // re-fit when the post opens (it starts collapsed) or the window resizes
    if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
    window.addEventListener("resize", fit);
    status();
    root.refit = fit;                                // posts.js calls this when a post is opened
    return root;
  }

  window.RRSlideshow = { create: create };
})();
