/* ==========================================================================
   Rahul Rajesh — Markdown-lite renderer
   --------------------------------------------------------------------------
   A tiny, safe subset renderer for blog/journey post bodies. HTML in the
   source is escaped first, then a limited set of Markdown is applied:
     ## heading            -> <h3> (### -> <h4>)
     **bold**  *italic*  _italic_  `code`
     [text](https://url)   (http/https/mailto only)
     - item  /  * item     -> <ul>
     1. item               -> <ol>
     > quote               -> <blockquote>
     blank line            -> new paragraph; single newline -> <br>
   Exposes window.RRMarkdown.render(mdString) -> htmlString.
   ========================================================================== */
(function () {
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // inline formatting on already-escaped text
  function inline(s) {
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
      function (_, t, u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + t + "</a>"; });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s;
  }
  function render(md) {
    var blocks = String(md == null ? "" : md).replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
    return blocks.map(function (block) {
      if (!block.trim()) return "";
      var lines = block.split("\n");
      var h = block.match(/^(#{1,6})\s+([\s\S]*)$/);
      if (h && lines.length === 1) {
        var lvl = h[1].length <= 2 ? 3 : 4;            // #/## -> h3, ###+ -> h4
        return "<h" + lvl + ">" + inline(esc(h[2])) + "</h" + lvl + ">";
      }
      if (lines.every(function (l) { return /^>\s?/.test(l); })) {
        var q = lines.map(function (l) { return l.replace(/^>\s?/, ""); }).join(" ");
        return "<blockquote>" + inline(esc(q)) + "</blockquote>";
      }
      if (lines.every(function (l) { return /^[-*]\s+/.test(l); })) {
        return "<ul>" + lines.map(function (l) {
          return "<li>" + inline(esc(l.replace(/^[-*]\s+/, ""))) + "</li>";
        }).join("") + "</ul>";
      }
      if (lines.every(function (l) { return /^\d+\.\s+/.test(l); })) {
        return "<ol>" + lines.map(function (l) {
          return "<li>" + inline(esc(l.replace(/^\d+\.\s+/, ""))) + "</li>";
        }).join("") + "</ol>";
      }
      return "<p>" + lines.map(function (l) { return inline(esc(l)); }).join("<br>") + "</p>";
    }).join("\n");
  }
  window.RRMarkdown = { render: render };
})();
