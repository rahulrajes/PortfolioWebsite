/* ==========================================================================
   Rahul Rajesh — Studio (private post editor)
   --------------------------------------------------------------------------
   Owner-only publisher for the Blog + Journey pages (Posts tab) and the
   photography page's Wildlife / Other sets (Photos tab). Posts commit through
   the GitHub Contents API; photos commit as one batch through the Git Data
   API (see the PHOTOS section). Auth is a
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
      // Every upload gets a fresh, never-used name. (Numbering 1, 2, 3... broke
      // when editing a post after removing a photo: the next number could
      // point at a file that already existed, and GitHub refused the upload.)
      var stamp = Date.now().toString(36);
      newImages.forEach(function (b64, k) {
        chain = chain.then(function () {
          var path = "assets/img/" + coll + "/" + id + "/" + stamp + "-" + (k + 1) + ".jpg";
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

  /* ======================= PHOTOS (photography page) =======================
     Manages content/photos.json and the images under
     assets/img/photography/web/<set>/{card,full}/<name>.jpg.

     Every upload or save is ONE commit, made with GitHub's Git Data API
     (blobs -> tree -> commit -> move main). If main moved in the meantime
     (say a post was published), the commit is redone on top of the new main.

     Photos are identified by "name" (the file name without .jpg). Deleted
     names go in photos.json "removed", so tools/build_photos.py never
     re-adds a photo you deleted here. */
  var PHOTO_BASE = "assets/img/photography/web/";
  var PHOTO_SETS = ["wildlife", "other"];
  var SET_LABEL = { wildlife: "Wildlife", other: "Other" };
  var CARD = { edge: 900, quality: 0.78 };    // same sizes as tools/build_photos.py
  var FULL = { edge: 2400, quality: 0.86 };
  var PH = { loaded: false, headSha: null, work: null, byName: {}, deleted: {}, dirty: 0, uploads: [], busy: false };

  function ghApi(method, path, body) {
    return fetch("https://api.github.com/repos/" + GH.owner + "/" + GH.repo + path, {
      method: method, headers: headers(), cache: "no-store", body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) {
        var e = new Error("GitHub " + method + " " + r.status + " — " + t.slice(0, 160)); e.status = r.status; throw e;
      });
      return r.json();
    });
  }

  function nameOf(e) { return e.name || e.card.split("/").pop().replace(/\.jpg$/i, ""); }
  function photoPaths(set, name) {
    return { card: PHOTO_BASE + set + "/card/" + name + ".jpg", full: PHOTO_BASE + set + "/full/" + name + ".jpg" };
  }
  function normalize(m) {
    var out = {};
    PHOTO_SETS.forEach(function (s) { out[s] = (m && m[s]) || []; });
    out.removed = (m && m.removed) || [];
    return out;
  }
  function rawUrl(path) {
    return "https://raw.githubusercontent.com/" + GH.owner + "/" + GH.repo + "/" + PH.headSha + "/" + path;
  }
  function phMsg(text, kind) { msg($("phMsg"), text, kind); }
  function curSet() { return $("phSet").value; }

  /* ---- load the current photos.json from main ---- */
  function phLoad() {
    phMsg("Loading photos…");
    return ghApi("GET", "/git/ref/heads/" + GH.branch).then(function (ref) {
      PH.headSha = ref.object.sha;
      return ghApi("GET", "/contents/content/photos.json?ref=" + PH.headSha);
    }).then(function (got) {
      var m = normalize(JSON.parse(decB64(got.content)));
      PH.work = {}; PH.byName = {}; PH.deleted = {}; PH.dirty = 0;
      PHOTO_SETS.forEach(function (s) {
        PH.work[s] = m[s].map(function (e) { var n = nameOf(e); PH.byName[n] = e; return n; });
      });
      PH.loaded = true; phMsg(""); phRender();
    }).catch(function (e) { phMsg(e.message, "err"); });
  }

  /* ---- grid of the current set, with reorder / move / delete ---- */
  function phRender() {
    var set = curSet(), other = set === "wildlife" ? "other" : "wildlife";
    $("phSetName").textContent = SET_LABEL[set];
    var grid = $("phGrid"); grid.innerHTML = "";
    if (!PH.loaded) return;
    var names = PH.work[set];
    $("phCount").textContent = names.length + " photo" + (names.length === 1 ? "" : "s") + " on the site";
    names.forEach(function (n, i) {
      var e = PH.byName[n];
      var tile = document.createElement("div"); tile.className = "ph__tile";
      var img = document.createElement("img"); img.loading = "lazy"; img.alt = ""; img.src = rawUrl(e.card);
      tile.appendChild(img);
      var tools = document.createElement("div"); tools.className = "ph__tools";
      function tool(label, title, fn, cls) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title;
        if (cls) b.className = cls;
        b.addEventListener("click", fn); tools.appendChild(b);
      }
      tool("‹", "Move earlier", function () { phMove(set, i, -1); });
      tool("›", "Move later", function () { phMove(set, i, 1); });
      tool("⇄", "Move to " + SET_LABEL[other], function () {
        PH.work[set].splice(i, 1); PH.work[other].unshift(n); phChanged();
      });
      tool("✕", "Delete from the site", function () {
        if (!confirm("Delete this photo from the photography page?")) return;
        PH.work[set].splice(i, 1); PH.deleted[n] = true; phChanged();
      }, "is-danger");
      tile.appendChild(tools); grid.appendChild(tile);
    });
    $("phSave").hidden = !PH.dirty;
    $("phSaveText").textContent = PH.dirty + " unsaved change" + (PH.dirty === 1 ? "" : "s");
  }
  function phMove(set, i, d) {
    var a = PH.work[set], j = i + d;
    if (j < 0 || j >= a.length) return;
    var t = a[i]; a[i] = a[j]; a[j] = t; phChanged();
  }
  function phChanged() { PH.dirty++; phRender(); }

  /* ---- one commit for any set of file + photos.json changes ----
     plan(fresh photos.json) returns { manifest, files: [
       { path, b64 }        new file
       { path, fromPath }   copy an existing file (used for moves)
       { path, del: true }  delete ] } */
  function phCommit(message, plan) {
    var tries = 0, blobCache = {};
    function attempt() {
      tries++;
      var head, baseTree, treeMap = {};
      return ghApi("GET", "/git/ref/heads/" + GH.branch).then(function (ref) {
        head = ref.object.sha;
        return ghApi("GET", "/git/commits/" + head);
      }).then(function (c) {
        baseTree = c.tree.sha;
        return Promise.all([
          ghApi("GET", "/git/trees/" + baseTree + "?recursive=1"),
          ghApi("GET", "/contents/content/photos.json?ref=" + head)
        ]);
      }).then(function (res) {
        res[0].tree.forEach(function (t) { if (t.type === "blob") treeMap[t.path] = t.sha; });
        var out = plan(normalize(JSON.parse(decB64(res[1].content))));
        var entries = [], chain = Promise.resolve(), total = out.files.filter(function (f) { return f.b64; }).length, done = 0;
        function entry(path, sha) { entries.push({ path: path, mode: "100644", type: "blob", sha: sha }); }
        out.files.forEach(function (f) {
          chain = chain.then(function () {
            if (f.del) { if (treeMap[f.path]) entry(f.path, null); return; }
            if (f.fromPath) { if (treeMap[f.fromPath]) entry(f.path, treeMap[f.fromPath]); return; }
            if (blobCache[f.path]) { entry(f.path, blobCache[f.path]); done++; return; }
            return ghApi("POST", "/git/blobs", { content: f.b64, encoding: "base64" }).then(function (b) {
              blobCache[f.path] = b.sha; entry(f.path, b.sha);
              done++; phMsg("Uploading " + done + " / " + total + "…");
            });
          });
        });
        return chain.then(function () {
          entries.push({ path: "content/photos.json", mode: "100644", type: "blob",
                         content: JSON.stringify(out.manifest, null, 2) + "\n" });
          phMsg("Saving…");
          return ghApi("POST", "/git/trees", { base_tree: baseTree, tree: entries });
        });
      }).then(function (tree) {
        return ghApi("POST", "/git/commits", { message: message, tree: tree.sha, parents: [head] });
      }).then(function (commit) {
        return ghApi("PATCH", "/git/refs/heads/" + GH.branch, { sha: commit.sha });
      }).catch(function (e) {
        if (e.status === 422 && tries < 3) return attempt();     // main moved under us: redo on top of it
        throw e;
      });
    }
    return attempt();
  }

  /* ---- save reorder / move / delete ---- */
  function planEdits(fresh) {
    var out = { removed: fresh.removed.slice() }, files = [], freshBy = {}, freshSet = {}, placed = {};
    PHOTO_SETS.forEach(function (s) {
      fresh[s].forEach(function (e) { var n = nameOf(e); freshBy[n] = e; freshSet[n] = s; });
    });
    PHOTO_SETS.forEach(function (s) {
      out[s] = [];
      PH.work[s].forEach(function (n) {
        var e = freshBy[n];
        if (!e) return;                                   // already gone on GitHub
        placed[n] = true;
        if (freshSet[n] !== s) {                          // moved to the other set: move its files too
          var p = photoPaths(s, n);
          files.push({ path: p.card, fromPath: e.card }, { path: p.full, fromPath: e.full },
                     { path: e.card, del: true }, { path: e.full, del: true });
          e = { name: n, card: p.card, full: p.full, w: e.w, h: e.h };
        }
        out[s].push(e);
      });
    });
    PHOTO_SETS.forEach(function (s) {                     // not placed: deleted here, or added since we loaded
      fresh[s].forEach(function (e) {
        var n = nameOf(e);
        if (placed[n]) return;
        if (PH.deleted[n]) {
          files.push({ path: e.card, del: true }, { path: e.full, del: true });
          if (out.removed.indexOf(n) < 0) out.removed.push(n);
        } else out[s].push(e);
      });
    });
    return { manifest: { wildlife: out.wildlife, other: out.other, removed: out.removed }, files: files };
  }
  function phSave() {
    if (PH.busy) return;
    PH.busy = true; $("phSaveBtn").disabled = true;
    phCommit("studio: update photos", planEdits).then(function () {
      phMsg("Saved! The photography page updates in ~1 minute.", "ok");
      return phLoad().then(function () { phMsg("Saved! The photography page updates in ~1 minute.", "ok"); });
    }).catch(function (e) { phMsg(e.message, "err"); })
      .then(function () { PH.busy = false; $("phSaveBtn").disabled = false; });
  }

  /* ---- uploads ---- */
  // Downscale in halves first (sharper than one big jump), then to the exact
  // size. Drawing to a canvas also drops EXIF/GPS, and browsers apply the
  // photo's rotation flag when drawing, so the result is upright.
  function toJpeg(img, edge, quality) {
    var scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    var src = img, sw = img.naturalWidth, sh = img.naturalHeight;
    while (sw / 2 >= w * 1.05) {
      var c2 = document.createElement("canvas"); c2.width = Math.round(sw / 2); c2.height = Math.round(sh / 2);
      var x2 = c2.getContext("2d"); x2.imageSmoothingQuality = "high"; x2.drawImage(src, 0, 0, c2.width, c2.height);
      src = c2; sw = c2.width; sh = c2.height;
    }
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(src, 0, 0, w, h);
    return { b64: c.toDataURL("image/jpeg", quality).split(",")[1], w: w, h: h };
  }
  function readPhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var full = toJpeg(img, FULL.edge, FULL.quality), card = toJpeg(img, CARD.edge, CARD.quality);
          resolve({ full: full.b64, card: card.b64, w: full.w, h: full.h,
                    name: slug(file.name.replace(/\.[^.]+$/, "")) + "-" + Math.random().toString(36).slice(2, 6) });
        } catch (e) { reject(e); }
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Couldn't read " + file.name)); };
      img.src = url;
    });
  }
  function phRenderUploads() {
    var box = $("phThumbs"); box.innerHTML = "";
    PH.uploads.forEach(function (u, i) {
      var d = document.createElement("div"); d.className = "studio__thumb";
      var im = document.createElement("img"); im.src = "data:image/jpeg;base64," + u.card; d.appendChild(im);
      var x = document.createElement("button"); x.type = "button"; x.className = "studio__thumbx"; x.textContent = "×";
      x.addEventListener("click", function () { PH.uploads.splice(i, 1); phRenderUploads(); });
      d.appendChild(x); box.appendChild(d);
    });
    var n = PH.uploads.length;
    $("phUploadBtn").hidden = $("phClearBtn").hidden = !n;
    $("phUploadBtn").textContent = "Upload " + n + " photo" + (n === 1 ? "" : "s") + " to " + SET_LABEL[curSet()];
  }
  function phUpload() {
    if (PH.busy || !PH.uploads.length) return;
    if (PH.dirty) { phMsg("Save or discard your other changes first.", "err"); return; }
    var set = curSet(), items = PH.uploads.slice();
    PH.busy = true; $("phUploadBtn").disabled = true;
    phCommit("studio: add " + items.length + " photo" + (items.length === 1 ? "" : "s") + " to " + set, function (fresh) {
      var files = [], list = fresh[set].slice(), added = [];
      items.forEach(function (u) {
        var p = photoPaths(set, u.name);
        files.push({ path: p.card, b64: u.card }, { path: p.full, b64: u.full });
        added.push({ name: u.name, card: p.card, full: p.full, w: u.w, h: u.h });
      });
      fresh[set] = added.concat(list);                 // new photos lead the set
      return { manifest: { wildlife: fresh.wildlife, other: fresh.other, removed: fresh.removed }, files: files };
    }).then(function () {
      PH.uploads = []; phRenderUploads();
      return phLoad().then(function () { phMsg("Uploaded! The photography page updates in ~1 minute.", "ok"); });
    }).catch(function (e) { phMsg(e.message, "err"); })
      .then(function () { PH.busy = false; $("phUploadBtn").disabled = false; });
  }

  function bindPhotos() {
    Array.prototype.forEach.call(document.querySelectorAll(".studio__tab"), function (t) {
      t.addEventListener("click", function () {
        var photos = t.dataset.tab === "photos";
        Array.prototype.forEach.call(document.querySelectorAll(".studio__tab"), function (b) { b.setAttribute("aria-selected", String(b === t)); });
        $("postsPanel").hidden = photos; $("photosPanel").hidden = !photos; $("collectionWrap").hidden = photos;
        if (photos && !PH.loaded) phLoad();
      });
    });
    $("phSet").addEventListener("change", function () { phRender(); phRenderUploads(); });
    $("phInput").addEventListener("change", function (e) {
      var files = Array.prototype.slice.call(e.target.files), i = 0, failed = [];
      e.target.value = "";
      (function next() {                                 // one at a time: big phone photos use a lot of memory
        if (i >= files.length) {
          phRenderUploads();
          phMsg(failed.length ? "Skipped " + failed.join(", ") + " (if it's HEIC, open the Studio in Safari or export as JPEG)." : "", failed.length ? "err" : "");
          return;
        }
        var f = files[i++];
        phMsg("Preparing " + i + " / " + files.length + "…");
        readPhoto(f).then(function (u) { PH.uploads.push(u); phRenderUploads(); })
          .catch(function () { failed.push(f.name); })
          .then(next);
      })();
    });
    $("phUploadBtn").addEventListener("click", phUpload);
    $("phClearBtn").addEventListener("click", function () { PH.uploads = []; phRenderUploads(); });
    $("phSaveBtn").addEventListener("click", phSave);
    $("phDiscardBtn").addEventListener("click", function () { phLoad(); });
  }

  bindGate(); bindEditor(); bindPhotos(); showGate();
})();
