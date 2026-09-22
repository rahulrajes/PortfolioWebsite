/* ==========================================================================
   Rahul Rajesh — content loader
   --------------------------------------------------------------------------
   Lets page copy live in plain .txt files under /content, so writing/editing
   is as easy as opening a text file. Any element with [data-content="path.txt"]
   gets its text fetched, split into paragraphs on blank lines, and rendered.

   Inline links use markdown syntax:  [visible text](https://url)
   (only http/https/mailto are allowed; everything else is escaped as text.)

   Usage:  <div class="prose" data-content="content/about/intro.txt"></div>
   Notes:  needs a server (localhost / GitHub Pages) — fetch() won't run on
           file://. Blank lines separate paragraphs.
   ========================================================================== */
(function () {
  /* escape HTML so file text can never inject markup */
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  /* turn [text](url) into a safe anchor; escape everything else */
  function render(raw) {
    let out = "", last = 0;
    const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      out += esc(raw.slice(last, m.index));
      const ext = /^https?:/.test(m[2]) ? ' target="_blank" rel="noopener"' : "";
      out += '<a href="' + esc(m[2]) + '"' + ext + ">" + esc(m[1]) + "</a>";
      last = m.index + m[0].length;
    }
    out += esc(raw.slice(last));
    return out;
  }

  const slots = document.querySelectorAll("[data-content]");
  slots.forEach((el) => {
    const src = el.getAttribute("data-content");
    fetch(src)
      .then((r) => { if (!r.ok) throw new Error(r.status + " " + src); return r.text(); })
      .then((text) => {
        const paras = text.trim().split(/\n\s*\n/);            // blank line = new paragraph
        el.innerHTML = paras
          .map((p) => "<p>" + render(p.trim().replace(/\s*\n\s*/g, " ")) + "</p>")
          .join("");
        el.classList.add("is-loaded");
      })
      .catch((err) => {
        console.warn("content: could not load", src, err.message);
        el.classList.add("is-error");
      });
  });

  /* -------- gentle scroll-reveal for [data-reveal] elements -------- */
  const reveals = document.querySelectorAll("[data-reveal]");
  if (reveals.length) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      reveals.forEach((el) => el.classList.add("is-in"));
    } else {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
        });
      }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
      reveals.forEach((el) => io.observe(el));
    }
  }
})();
