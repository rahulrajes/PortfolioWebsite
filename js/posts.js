/* ==========================================================================
   Rahul Rajesh — post renderer (blog + journey)
   --------------------------------------------------------------------------
   Reads content/<collection>.json and renders posts newest-first into the
   same dropdown (accordion) format as the Academic page. A post with images
   gets an image slider (reusing js/slider.js). Posts are authored from the
   private studio editor; this file only renders.

   The page provides a mount element: <div data-posts="blog"></div>
   ========================================================================== */
(function () {
  var mount = document.querySelector("[data-posts]");
  if (!mount) return;
  var collection = mount.getAttribute("data-posts");   // "blog" | "journey"

  fetch("content/" + collection + ".json?t=" + Date.now())
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (posts) { render(posts); })
    .catch(function (e) {
      console.warn("posts: could not load", collection, e.message);
      empty("No posts yet — check back soon.");
    });

  function empty(msg) { mount.innerHTML = '<p class="posts-empty">' + msg + "</p>"; }

  function render(posts) {
    if (!Array.isArray(posts) || !posts.length) { empty("No posts yet — check back soon."); return; }
    posts.sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "") ||
             (b.created || "").localeCompare(a.created || "");
    });

    var acc = document.createElement("div");
    acc.className = "acc";

    posts.forEach(function (p) {
      var d = document.createElement("details");
      d.className = "acc__item";

      var sum = document.createElement("summary");
      sum.className = "acc__head";
      sum.innerHTML =
        '<span class="acc__lead"><span class="acc__title"></span></span>' +
        '<span class="acc__date"></span>' +
        '<svg class="acc__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      sum.querySelector(".acc__title").textContent = p.title || "Untitled";
      sum.querySelector(".acc__date").textContent = formatDate(p.date);

      var body = document.createElement("div");
      body.className = "acc__body";

      var prose = document.createElement("div");
      prose.className = "prose post__body";
      prose.innerHTML = window.RRMarkdown ? window.RRMarkdown.render(p.body || "") : plain(p.body || "");
      body.appendChild(prose);

      if (Array.isArray(p.images) && p.images.length) {
        var slider = buildSlider(p.images);
        body.appendChild(slider);
        if (window.RRSlider) window.RRSlider.init(slider);
      }

      d.appendChild(sum);
      d.appendChild(body);
      acc.appendChild(d);
    });

    mount.innerHTML = "";
    mount.appendChild(acc);
  }

  function buildSlider(images) {
    var wrap = document.createElement("div");
    wrap.className = "slider";
    wrap.setAttribute("data-slider", "");
    var vp = document.createElement("div");
    vp.className = "slider__viewport";
    var track = document.createElement("div");
    track.className = "slider__track";
    images.forEach(function (src) {
      var fig = document.createElement("figure");
      fig.className = "slider__slide";
      var img = document.createElement("img");
      img.src = src; img.loading = "lazy"; img.alt = "";
      fig.appendChild(img);
      track.appendChild(fig);
    });
    vp.appendChild(track);
    wrap.appendChild(vp);
    return wrap;
  }

  function formatDate(d) {
    if (!d) return "";
    var p = String(d).split("-");
    if (p.length !== 3) return d;
    var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var m = mo[(+p[1]) - 1] || "";
    return (m + " " + (+p[2]) + ", " + p[0]).trim();
  }

  function plain(s) {
    var e = document.createElement("div");
    e.textContent = s;
    return "<p>" + e.innerHTML.replace(/\n/g, "<br>") + "</p>";
  }
})();
