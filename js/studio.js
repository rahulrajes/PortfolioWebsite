/* ==========================================================================
   Rahul Rajesh — Studio (private post editor)
   --------------------------------------------------------------------------
   Owner-only publisher for the Blog + Journey pages. Commits posts (and
   resized images) to the repo via the GitHub Contents API. Auth is a
   fine-grained Personal Access Token, encrypted in this browser with a
   passphrase (WebCrypto) and never committed. This page is public but
   useless without the token.

   Repo target below — update if the repo ever moves.
   ========================================================================== */
(function () {
  var GH = { owner: "rahulrajes", repo: "PortfolioWebsite", branch: "main" };
  var LS_KEY = "rr_studio_v1";
  var TOKEN = null;                 // held in memory only after unlock
  var newImages = [];              // base64 JPEGs staged for upload
  var existingImages = [];         // image paths kept when editing
  var editingCreated = null;

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- base64 helpers ---------- */
  function encB64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function decB64(b64) { return decodeURIComponent(escape(atob(String(b64).replace(/\s/g, "")))); }
  function bytesToB64(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    var s = atob(b64), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }

  /* ---------- crypto: encrypt the token with the passphrase ---------- */
  function deriveKey(pass, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"])
      .then(function (km) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: 120000, hash: "SHA-256" },
          km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      });
  }
  function encryptToken(token, pass) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(pass, salt).then(function (key) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(token));
    }).then(function (ct) {
      return { salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(ct) };
    });
  }
  function decryptToken(obj, pass) {
    return deriveKey(pass, b64ToBytes(obj.salt)).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(obj.iv) }, key, b64ToBytes(obj.ct));
    }).then(function (pt) { return new TextDecoder().decode(pt); });
  }

  /* ---------- GitHub Contents API ---------- */
  function api(path) { return "https://api.github.com/repos/" + GH.owner + "/" + GH.repo + "/contents/" + path; }
  function headers() {
    return { "Authorization": "Bearer " + TOKEN, "Accept": "application/vnd.github+json", "Content-Type": "application/json" };
  }
  function ghGet(path) {
    return fetch(api(path) + "?ref=" + GH.branch, { headers: headers(), cache: "no-store" }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) return r.text().then(function (t) { throw new Error("GitHub GET " + r.status + " — " + t.slice(0, 120)); });
      return r.json();
    });
  }
  function ghPut(path, contentB64, sha, message) {
    var body = { message: message, content: contentB64, branch: GH.branch };
    if (sha) body.sha = sha;
    return fetch(api(path), { method: "PUT", headers: headers(), body: JSON.stringify(body) }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("GitHub PUT " + r.status + " — " + t.slice(0, 160)); });
      return r.json();
    });
  }

  /* ---------- image resize (client-side) ---------- */
  function resizeImage(file, maxEdge) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          var c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL("image/jpeg", 0.72).split(",")[1]);
        };
        img.onerror = reject; img.src = fr.result;
      };
      fr.onerror = reject; fr.readAsDataURL(file);
    });
  }

  /* ---------- small utils ---------- */
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "post"; }
  function makeId(title, date) { return date + "-" + slug(title) + "-" + Math.random().toString(36).slice(2, 6); }
  function msg(el, text, kind) { el.textContent = text || ""; el.className = "studio__msg" + (kind ? " is-" + kind : ""); }

  /* ---------- gate (setup / unlock) ---------- */
  function showGate() {
    $("editor").hidden = true; $("gate").hidden = false;
    var stored = localStorage.getItem(LS_KEY);
    $("setup").hidden = !!stored;
    $("unlock").hidden = !stored;
  }
  function showEditor() {
    $("gate").hidden = true; $("editor").hidden = false;
    $("date").value = $("date").value || todayISO();
    loadPosts();
  }

  function bindGate() {
    $("tokenLink").href = "https://github.com/settings/personal-access-tokens/new";
    $("saveSetup").addEventListener("click", function () {
      var token = $("tokenInput").value.trim();
      var pass = $("passSet").value;
      if (!token || pass.length < 4) { msg($("gateMsg"), "Enter a token and a passphrase (4+ chars).", "err"); return; }
      encryptToken(token, pass).then(function (obj) {
        localStorage.setItem(LS_KEY, JSON.stringify(obj));
        TOKEN = token; $("tokenInput").value = ""; $("passSet").value = "";
        msg($("gateMsg"), ""); showEditor();
      });
    });
    $("doUnlock").addEventListener("click", function () {
      var pass = $("passUnlock").value;
      var stored = localStorage.getItem(LS_KEY);
      if (!stored) { showGate(); return; }
      decryptToken(JSON.parse(stored), pass).then(function (tok) {
        TOKEN = tok; $("passUnlock").value = ""; msg($("gateMsg"), ""); showEditor();
      }).catch(function () { msg($("gateMsg"), "Wrong passphrase.", "err"); });
    });
    $("resetToken").addEventListener("click", function () {
      if (confirm("Forget the stored token on this browser?")) { localStorage.removeItem(LS_KEY); TOKEN = null; showGate(); }
    });
    $("lockBtn").addEventListener("click", function () { TOKEN = null; showGate(); });
  }

  /* ---------- editor ---------- */
  function renderThumbs() {
    var box = $("thumbs"); box.innerHTML = "";
    existingImages.forEach(function (path, i) {
      box.appendChild(thumb(path, "existing", i));
    });
    newImages.forEach(function (b64, i) {
      box.appendChild(thumb("data:image/jpeg;base64," + b64, "new", i));
    });
  }
  function thumb(src, kind, i) {
    var d = document.createElement("div"); d.className = "studio__thumb";
    var im = document.createElement("img"); im.src = src; d.appendChild(im);
    var x = document.createElement("button"); x.type = "button"; x.className = "studio__thumbx"; x.textContent = "×";
    x.addEventListener("click", function () {
      if (kind === "existing") existingImages.splice(i, 1); else newImages.splice(i, 1);
      renderThumbs();
    });
    d.appendChild(x); return d;
  }

  function clearForm() {
    $("editId").value = ""; $("title").value = ""; $("date").value = todayISO();
    $("body").value = ""; $("preview").innerHTML = "";
    newImages = []; existingImages = []; editingCreated = null; renderThumbs();
  }

  function loadForm(post) {
    $("editId").value = post.id; $("title").value = post.title || "";
    $("date").value = post.date || todayISO(); $("body").value = post.body || "";
    $("preview").innerHTML = window.RRMarkdown.render(post.body || "");
    existingImages = (post.images || []).slice(); newImages = []; editingCreated = post.created || null;
    renderThumbs();
    window.scrollTo(0, 0);
  }

  function loadPosts() {
    var coll = $("collection").value;
    $("collLabel").textContent = coll === "blog" ? "Blog" : "Journey";
    var list = $("postList"); list.innerHTML = "Loading…";
    ghGet("content/" + coll + ".json").then(function (got) {
      var arr = got ? JSON.parse(decB64(got.content)) : [];
      arr.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
      list.innerHTML = "";
      if (!arr.length) { list.innerHTML = '<p class="studio__msg">No posts yet.</p>'; return; }
      arr.forEach(function (p) {
        var row = document.createElement("div"); row.className = "studio__row";
        var meta = document.createElement("div");
        meta.innerHTML = '<strong></strong><span></span>';
        meta.querySelector("strong").textContent = p.title || "Untitled";
        meta.querySelector("span").textContent = " · " + (p.date || "");
        var edit = document.createElement("button"); edit.type = "button"; edit.className = "studio__link"; edit.textContent = "Edit";
        edit.addEventListener("click", function () { loadForm(p); });
        var del = document.createElement("button"); del.type = "button"; del.className = "studio__link studio__link--danger"; del.textContent = "Delete";
        del.addEventListener("click", function () { deletePost(p.id, coll); });
        var actions = document.createElement("div"); actions.appendChild(edit); actions.appendChild(del);
        row.appendChild(meta); row.appendChild(actions); list.appendChild(row);
      });
    }).catch(function (e) { list.innerHTML = '<p class="studio__msg is-err">' + e.message + "</p>"; });
  }

  function publish() {
    var coll = $("collection").value;
    var title = $("title").value.trim();
    if (!title) { msg($("status"), "Give the post a title.", "err"); return; }
    var date = $("date").value || todayISO();
    var body = $("body").value;
    var editId = $("editId").value;
    msg($("status"), "Publishing…");

    ghGet("content/" + coll + ".json").then(function (got) {
      var arr = got ? JSON.parse(decB64(got.content)) : [];
      var sha = got ? got.sha : null;
      var id = editId || makeId(title, date);

      // upload staged images sequentially, collecting their paths
      var paths = existingImages.slice();
      var chain = Promise.resolve();
      newImages.forEach(function (b64) {
        chain = chain.then(function () {
          var n = paths.length + 1;
          var path = "assets/img/" + coll + "/" + id + "/" + n + ".jpg";
          return ghPut(path, b64, null, "studio: image " + path).then(function () { paths.push(path); });
        });
      });

      return chain.then(function () {
        var post = { id: id, title: title, date: date, body: body, images: paths,
                     created: editId ? (editingCreated || new Date().toISOString()) : new Date().toISOString() };
        var i = arr.findIndex(function (p) { return p.id === id; });
        if (i >= 0) arr[i] = post; else arr.unshift(post);
        var json = JSON.stringify(arr, null, 2) + "\n";
        return ghPut("content/" + coll + ".json", encB64(json), sha, "studio: publish \"" + title + "\"");
      });
    }).then(function () {
      msg($("status"), "Published! It'll appear on the site in ~1 minute.", "ok");
      clearForm(); loadPosts();
    }).catch(function (e) { msg($("status"), e.message, "err"); });
  }

  function deletePost(id, coll) {
    if (!confirm("Delete this post? (Images stay in the repo but stop showing.)")) return;
    ghGet("content/" + coll + ".json").then(function (got) {
      if (!got) return;
      var arr = JSON.parse(decB64(got.content)).filter(function (p) { return p.id !== id; });
      return ghPut("content/" + coll + ".json", encB64(JSON.stringify(arr, null, 2) + "\n"), got.sha, "studio: delete post");
    }).then(function () { loadPosts(); }).catch(function (e) { msg($("status"), e.message, "err"); });
  }

  function bindEditor() {
    $("collection").addEventListener("change", function () { clearForm(); loadPosts(); });
    $("body").addEventListener("input", function () { $("preview").innerHTML = window.RRMarkdown.render($("body").value); });
    $("imgInput").addEventListener("change", function (e) {
      var files = Array.prototype.slice.call(e.target.files);
      msg($("status"), "Processing images…");
      Promise.all(files.map(function (f) { return resizeImage(f, 1600); })).then(function (b64s) {
        b64s.forEach(function (b) { newImages.push(b); });
        renderThumbs(); msg($("status"), ""); $("imgInput").value = "";
      }).catch(function () { msg($("status"), "Could not read an image.", "err"); });
    });
    $("publishBtn").addEventListener("click", publish);
    $("clearBtn").addEventListener("click", clearForm);
  }

  bindGate(); bindEditor(); showGate();
})();
