/* ==========================================================================
   Rahul Rajesh — photo + video slideshow (Blog + Journey posts)
   --------------------------------------------------------------------------
   One big photo or video at a time, at its own shape (nothing cropped).
   Changing slides moves the current one away with a little depth (it shrinks
   and fades) while the next glides in from the side you're heading toward.

     - arrows on the sides, dots + "2 / 5" counter underneath
     - drag / swipe: the slide follows your finger, then snaps to the next
       one or springs back
     - Left / Right arrow keys once the slideshow has focus
     - photos: click / tap opens it full size in the lightbox (js/gallery.js)
     - videos: play muted on a loop while they're the current slide and on
       screen; the speaker button turns sound on/off, a tap pauses/plays
     - the frame's height eases to fit each slide; tall ones are capped so
       they never run off-screen

   Used by js/posts.js:  RRSlideshow.create(media, "Post title")
   media items: "photo.jpg"  or  { type: "video", src, poster, w, h }
   ========================================================================== */
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var MAX_H = function () { return Math.min(window.innerHeight * 0.72, 680); };   // tallest a slide may be
  var SWIPE = 60;                                                                  // px drag to change slide

  var ICON_MUTED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l4 6M21 9l-4 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  function create(media, title) {
    var items = media.map(function (m) { return typeof m === "string" ? { type: "image", src: m } : m; });
    var n = items.length, cur = 0, busy = false, onScreen = false, soundOn = false;
    var hasVideo = items.some(function (m) { return m.type === "video"; });
    var root = el("div", "slides" + (n < 2 ? " slides--single" : ""));
    root.tabIndex = 0;
    root.setAttribute("role", "region");
    root.setAttribute("aria-roledescription", "slideshow");
    root.setAttribute("aria-label", (title ? title + " photos" : "Photos"));

    var stage = el("div", "slides__stage");
    var slides = items.map(function (m, i) {
      var s = el("figure", "slides__slide" + (i === 0 ? " is-current" : ""));
      var node;
      if (m.type === "video") {
        node = el("video", "slides__img slides__video");
        node.muted = true; node.loop = true; node.playsInline = true;
        node.setAttribute("playsinline", ""); node.setAttribute("muted", "");
        node.preload = "metadata";
        if (m.poster) node.poster = m.poster;
        node.setAttribute("aria-label", (title || "Video") + " (" + (i + 1) + " of " + n + ")");
        node.addEventListener("loadedmetadata", function () { if (i === cur) fit(); });
      } else {
        node = el("img", "slides__img");
        node.alt = (title || "Photo") + " (" + (i + 1) + " of " + n + ")";
        node.addEventListener("load", function () { if (i === cur) fit(); });
      }
      node.draggable = false;
      node.dataset.src = m.src;
      if (i < 2) node.src = m.src;                   // first two now, the rest just before they're shown
      s.appendChild(node);
      stage.appendChild(s);
      return s;
    });
    root.appendChild(stage);

    // one sound button for the whole slideshow, shown on video slides
    var soundBtn = null;
    if (hasVideo) {
      soundBtn = el("button", "slides__sound", ICON_MUTED); soundBtn.type = "button";
      soundBtn.setAttribute("aria-label", "Turn sound on");
      soundBtn.addEventListener("click", function () {
        soundOn = !soundOn;
        soundBtn.innerHTML = soundOn ? ICON_SOUND : ICON_MUTED;
        soundBtn.setAttribute("aria-label", soundOn ? "Turn sound off" : "Turn sound on");
        var v = video(cur);
        if (v) { v.muted = !soundOn; if (v.paused) v.play().catch(function () {}); }
      });
      stage.appendChild(soundBtn);
    }

    var prev, next, dots = [], count;
    if (n > 1) {
      prev = el("button", "slides__nav slides__nav--prev", "&lsaquo;"); prev.type = "button"; prev.setAttribute("aria-label", "Previous");
      next = el("button", "slides__nav slides__nav--next", "&rsaquo;"); next.type = "button"; next.setAttribute("aria-label", "Next");
      stage.appendChild(prev); stage.appendChild(next);
      var bar = el("div", "slides__bar");
      var dotWrap = el("div", "slides__dots");
      items.forEach(function (m, i) {
        var d = el("button", "slides__dot" + (i === 0 ? " is-on" : "")); d.type = "button";
        d.setAttribute("aria-label", (m.type === "video" ? "Video " : "Photo ") + (i + 1));
        d.addEventListener("click", function () { go(i); });
        dotWrap.appendChild(d); dots.push(d);
      });
      count = el("span", "slides__count");
      bar.appendChild(dotWrap); bar.appendChild(count);
      root.appendChild(bar);
      prev.addEventListener("click", function () { go(cur - 1); });
      next.addEventListener("click", function () { go(cur + 1); });
    }

    function node(i) { return slides[i].firstChild; }
    function video(i) { var nd = node(i); return nd.tagName === "VIDEO" ? nd : null; }
    function load(i) {
      var nd = node((i + n) % n);
      if (!nd.getAttribute("src")) nd.src = nd.dataset.src;
    }

    // frame height = the current slide's height at full width, capped
    function fit() {
      var w = stage.clientWidth;
      if (!w) return;
      var m = items[cur], nd = node(cur), ratio = 2 / 3;
      if (m.type === "video") ratio = m.w && m.h ? m.h / m.w : (nd.videoWidth ? nd.videoHeight / nd.videoWidth : ratio);
      else if (nd.naturalWidth) ratio = nd.naturalHeight / nd.naturalWidth;
      var h = Math.round(Math.min(w * ratio, MAX_H()));
      stage.style.height = h + "px";
      slides.forEach(function (s) { s.firstChild.style.maxHeight = h + "px"; });
    }

    // only the current video plays, and only while the slideshow is on screen
    function syncVideos() {
      slides.forEach(function (s, i) {
        var v = video(i);
        if (!v) return;
        if (i === cur && onScreen) {
          load(i);
          v.muted = !soundOn;
          v.play().catch(function () {});
        } else if (!v.paused) v.pause();
      });
      if (soundBtn) soundBtn.classList.toggle("is-shown", items[cur].type === "video");
    }

    function status() {
      if (n < 2) return;
      dots.forEach(function (d, i) { d.classList.toggle("is-on", i === cur); });
      count.textContent = (cur + 1) + " / " + n;
    }

    function go(to) {
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
      fit(); status(); syncVideos();
      window.setTimeout(function () {
        out.classList.remove("is-out-left", "is-out-right");
        busy = false;
      }, reduce ? 0 : 620);
    }

    /* ---- drag / swipe: the slide follows the pointer ---- */
    var startX = null, dx = 0, moved = false;
    stage.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".slides__nav, .slides__sound") || busy) return;
      startX = e.clientX; dx = 0; moved = false;
      if (n > 1) slides[cur].classList.add("is-dragging");
    });
    window.addEventListener("pointermove", function (e) {
      if (startX === null || n < 2) return;
      dx = e.clientX - startX;
      if (Math.abs(dx) > 6) moved = true;
      slides[cur].style.transform = "translateX(" + dx + "px) rotate(" + (dx / 60) + "deg)";
    });
    function release() {
      if (startX === null) return;
      var s = slides[cur];
      startX = null;
      s.classList.remove("is-dragging");
      if (moved && Math.abs(dx) > SWIPE) go(dx < 0 ? cur + 1 : cur - 1);
      else s.style.transform = "";                                     // spring back
    }
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);                 // e.g. the page started scrolling

    // tap without dragging: photo -> full size in the lightbox; video -> pause / play
    stage.addEventListener("click", function (e) {
      if (moved || e.target.closest(".slides__nav, .slides__sound")) return;
      if (!e.target.closest(".slides__img")) return;
      var v = video(cur);
      if (v) { if (v.paused) v.play().catch(function () {}); else v.pause(); return; }
      if (!window.RRGallery) return;
      var photos = [], at = 0;
      items.forEach(function (m, i) {
        if (m.type === "video") return;
        if (i === cur) at = photos.length;
        photos.push({ src: m.src, alt: (title || "Photo") + " " + (photos.length + 1) });
      });
      window.RRGallery.open(photos, at);
    });

    root.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); go(cur + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(cur - 1); }
    });

    // re-fit when the post opens (it starts collapsed) or the window resizes
    if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
    window.addEventListener("resize", fit);
    if (hasVideo && window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        syncVideos();
      }, { threshold: 0.35 }).observe(stage);
    }
    status(); syncVideos();
    root.refit = function () { fit(); syncVideos(); };   // posts.js calls this when a post is opened
    return root;
  }

  window.RRSlideshow = { create: create };
})();
