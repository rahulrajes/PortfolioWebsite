/* ==========================================================================
   Rahul Rajesh — fluid text
   --------------------------------------------------------------------------
   Plain-JS port of Originkit's "Fluid Text" (ui_for_photography/fluid_text.tsx).
   A WebGL fluid simulation clipped to the letters of a headline: move the
   cursor (or drag a finger) to stir colored dye through the glyphs, click for
   a splash.

   Markup: any element with [data-fluid-text]. Its text is the headline, and
   its CSS font (family / size / weight / letter-spacing) sets the letters.
     <a class="fluid" data-fluid-text href="...">@rahuls__photos</a>
   The script adds a canvas inside and the class "fluid--on" once WebGL runs;
   CSS hides the plain text then (it stays readable for screen readers and as
   the fallback when WebGL is unavailable).
   ========================================================================== */
(function () {
  "use strict";

  /* ---- look (Originkit defaults) ---- */
  const PALETTE = ["#A855F7", "#EC4899", "#3B82F6", "#AFFF00", "#00FFF5"];
  const BASE_COLOR = "#f4efe6";          // letters where no dye has landed (site cream)
  const SPLAT_RADIUS = 7 / 20;
  const SPLAT_FORCE = 10 * 1000;
  const CURL = 50;
  const DENSITY_DISSIPATION = 5 * 0.5;
  const FAUX_BOLD = 0.035;               // outline added to thin serif strokes (x font size)

  const SHADING = true;
  const COLOR_SPEED = 0.125;
  const VELOCITY_DISSIPATION = 2;
  const PRESSURE = 1 / 20;
  const SIM_RESOLUTION = 128;
  const DYE_RESOLUTION = 1440;
  const PRESSURE_ITERATIONS = 20;

  function parseColor(input, multiplier) {
    let val = String(input || "").trim().replace("#", "");
    if (val.length === 3) val = val.split("").map(function (c) { return c + c; }).join("");
    const n = parseInt(val.slice(0, 6), 16);
    if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
    return {
      r: (((n >> 16) & 255) / 255) * multiplier,
      g: (((n >> 8) & 255) / 255) * multiplier,
      b: ((n & 255) / 255) * multiplier,
    };
  }

  /* ---- shaders (unchanged from the original) ---- */
  const BASE_VERTEX_SHADER = `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform vec2 texelSize;
    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`;

  const COPY_SHADER = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; uniform sampler2D uTexture;
    void main () { gl_FragColor = texture2D(uTexture, vUv); }`;

  const CLEAR_SHADER = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; uniform sampler2D uTexture; uniform float value;
    void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`;

  const DISPLAY_SHADER = `
    precision highp float; precision highp sampler2D;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform sampler2D uTexture; uniform sampler2D uMask; uniform vec2 texelSize; uniform vec4 uBase;
    void main () {
      float mask = texture2D(uMask, vUv).a;
      if (mask <= 0.0) discard;
      vec3 c = texture2D(uTexture, vUv).rgb;
      #ifdef SHADING
        vec3 lc = texture2D(uTexture, vL).rgb;
        vec3 rc = texture2D(uTexture, vR).rgb;
        vec3 tc = texture2D(uTexture, vT).rgb;
        vec3 bc = texture2D(uTexture, vB).rgb;
        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);
        vec3 n = normalize(vec3(dx, dy, length(texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);
        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
      #endif
      float d = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);
      vec3 color = uBase.rgb * uBase.a * (1.0 - d) + c;
      float m = max(color.r, max(color.g, color.b));
      if (m > 1.0) color /= m;
      gl_FragColor = vec4(color, mask * max(uBase.a, d));
    }`;

  const SPLAT_SHADER = `
    precision highp float; precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius;
    void main () {
      vec2 p = vUv - point.xy;
      p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      vec3 base = texture2D(uTarget, vUv).xyz;
      gl_FragColor = vec4(base + splat, 1.0);
    }`;

  const ADVECTION_SHADER = `
    precision highp float; precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity; uniform sampler2D uSource;
    uniform vec2 texelSize; uniform vec2 dyeTexelSize; uniform float dt; uniform float dissipation;
    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
      vec2 st = uv / tsize - 0.5;
      vec2 iuv = floor(st);
      vec2 fuv = fract(st);
      vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
      vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
      vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
      vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
      return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }
    void main () {
      #ifdef MANUAL_FILTERING
        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
        vec4 result = bilerp(uSource, coord, dyeTexelSize);
      #else
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = texture2D(uSource, coord);
      #endif
      float decay = 1.0 + dissipation * dt;
      gl_FragColor = result / decay;
    }`;

  const DIVERGENCE_SHADER = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y;
      float B = texture2D(uVelocity, vB).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) { L = -C.x; }
      if (vR.x > 1.0) { R = -C.x; }
      if (vT.y > 1.0) { T = -C.y; }
      if (vB.y < 0.0) { B = -C.y; }
      float div = 0.5 * (R - L + T - B);
      gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }`;

  const CURL_SHADER = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).y;
      float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x;
      float B = texture2D(uVelocity, vB).x;
      float vorticity = R - L - T + B;
      gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }`;

  const VORTICITY_SHADER = `
    precision highp float; precision highp sampler2D;
    varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
    uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;
    void main () {
      float L = texture2D(uCurl, vL).x;
      float R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x;
      float B = texture2D(uCurl, vB).x;
      float C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C;
      force.y *= -1.0;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity += force * dt;
      velocity = min(max(velocity, -1000.0), 1000.0);
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }`;

  const PRESSURE_SHADER = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
    uniform sampler2D uPressure; uniform sampler2D uDivergence;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      float divergence = texture2D(uDivergence, vUv).x;
      float pressure = (L + R + B + T - divergence) * 0.25;
      gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }`;

  const GRADIENT_SUBTRACT_SHADER = `
    precision mediump float; precision mediump sampler2D;
    varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
    uniform sampler2D uPressure; uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity.xy -= vec2(R - L, T - B);
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }`;

  /* ---- mount one headline ---- */
  function mount(host) {
    const text = host.textContent.trim();
    const canvas = document.createElement("canvas");
    canvas.className = "fluid__canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);

    const params = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: false };
    let isWebGL2 = true;
    let g = canvas.getContext("webgl2", params);
    if (!g) {
      isWebGL2 = false;
      g = canvas.getContext("webgl", params) || canvas.getContext("experimental-webgl", params);
    }
    if (!g) { canvas.remove(); return; }       // no WebGL: plain text stays visible

    let halfFloat, supportLinearFiltering;
    if (isWebGL2) {
      g.getExtension("EXT_color_buffer_float");
      supportLinearFiltering = g.getExtension("OES_texture_float_linear");
    } else {
      halfFloat = g.getExtension("OES_texture_half_float");
      supportLinearFiltering = g.getExtension("OES_texture_half_float_linear");
    }
    g.clearColor(0, 0, 0, 0);
    const halfFloatTexType = isWebGL2 ? g.HALF_FLOAT : halfFloat && halfFloat.HALF_FLOAT_OES;

    function supportRenderTextureFormat(internalFormat, format, type) {
      const texture = g.createTexture();
      g.bindTexture(g.TEXTURE_2D, texture);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texImage2D(g.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
      const fbo = g.createFramebuffer();
      g.bindFramebuffer(g.FRAMEBUFFER, fbo);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0);
      const ok = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE;
      g.deleteFramebuffer(fbo);
      g.deleteTexture(texture);
      return ok;
    }
    function getSupportedFormat(internalFormat, format, type) {
      if (!supportRenderTextureFormat(internalFormat, format, type)) {
        switch (internalFormat) {
          case g.R16F: return getSupportedFormat(g.RG16F, g.RG, type);
          case g.RG16F: return getSupportedFormat(g.RGBA16F, g.RGBA, type);
          default: return null;
        }
      }
      return { internalFormat: internalFormat, format: format };
    }
    const formatRGBA = isWebGL2 ? getSupportedFormat(g.RGBA16F, g.RGBA, halfFloatTexType) : getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType);
    const formatRG = isWebGL2 ? getSupportedFormat(g.RG16F, g.RG, halfFloatTexType) : getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType);
    const formatR = isWebGL2 ? getSupportedFormat(g.R16F, g.RED, halfFloatTexType) : getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType);
    if (!formatRGBA || !formatRG || !formatR) { canvas.remove(); return; }

    const dyeRes = supportLinearFiltering ? DYE_RESOLUTION : Math.min(DYE_RESOLUTION, 256);
    const shading = supportLinearFiltering ? SHADING : false;

    function compileShader(type, source, keywords) {
      const withDefines = keywords ? keywords.map(function (k) { return "#define " + k + "\n"; }).join("") + source : source;
      const shader = g.createShader(type);
      g.shaderSource(shader, withDefines);
      g.compileShader(shader);
      if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) console.warn("Fluid Text shader:", g.getShaderInfoLog(shader));
      return shader;
    }
    function Program(vs, fs) {
      this.program = g.createProgram();
      g.attachShader(this.program, vs);
      g.attachShader(this.program, fs);
      g.linkProgram(this.program);
      if (!g.getProgramParameter(this.program, g.LINK_STATUS)) console.warn("Fluid Text link:", g.getProgramInfoLog(this.program));
      this.uniforms = {};
      const count = g.getProgramParameter(this.program, g.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
        const name = g.getActiveUniform(this.program, i).name;
        this.uniforms[name] = g.getUniformLocation(this.program, name);
      }
    }
    Program.prototype.bind = function () { g.useProgram(this.program); };

    const vs = compileShader(g.VERTEX_SHADER, BASE_VERTEX_SHADER);
    const frag = function (src, kw) { return compileShader(g.FRAGMENT_SHADER, src, kw); };
    const copyProgram = new Program(vs, frag(COPY_SHADER));
    const clearProgram = new Program(vs, frag(CLEAR_SHADER));
    const splatProgram = new Program(vs, frag(SPLAT_SHADER));
    const advectionProgram = new Program(vs, frag(ADVECTION_SHADER, supportLinearFiltering ? undefined : ["MANUAL_FILTERING"]));
    const divergenceProgram = new Program(vs, frag(DIVERGENCE_SHADER));
    const curlProgram = new Program(vs, frag(CURL_SHADER));
    const vorticityProgram = new Program(vs, frag(VORTICITY_SHADER));
    const pressureProgram = new Program(vs, frag(PRESSURE_SHADER));
    const gradientSubtractProgram = new Program(vs, frag(GRADIENT_SUBTRACT_SHADER));
    const displayProgram = new Program(vs, frag(DISPLAY_SHADER, shading ? ["SHADING"] : []));

    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), g.STATIC_DRAW);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), g.STATIC_DRAW);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.enableVertexAttribArray(0);

    function blit(target, clear) {
      if (target == null) {
        g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
      } else {
        g.viewport(0, 0, target.width, target.height);
        g.bindFramebuffer(g.FRAMEBUFFER, target.fbo);
      }
      if (clear) {
        g.clearColor(0, 0, 0, target == null ? 0 : 1);
        g.clear(g.COLOR_BUFFER_BIT);
      }
      g.drawElements(g.TRIANGLES, 6, g.UNSIGNED_SHORT, 0);
    }

    function createFBO(w, h, internalFormat, format, type, param) {
      g.activeTexture(g.TEXTURE0);
      const texture = g.createTexture();
      g.bindTexture(g.TEXTURE_2D, texture);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, param);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, param);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texImage2D(g.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
      const fbo = g.createFramebuffer();
      g.bindFramebuffer(g.FRAMEBUFFER, fbo);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0);
      g.viewport(0, 0, w, h);
      g.clear(g.COLOR_BUFFER_BIT);
      return {
        texture: texture, fbo: fbo, width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h,
        attach: function (id) { g.activeTexture(g.TEXTURE0 + id); g.bindTexture(g.TEXTURE_2D, texture); return id; },
      };
    }
    function destroyFBO(t) { if (t) { g.deleteFramebuffer(t.fbo); g.deleteTexture(t.texture); } }
    function createDoubleFBO(w, h, internalFormat, format, type, param) {
      let fbo1 = createFBO(w, h, internalFormat, format, type, param);
      let fbo2 = createFBO(w, h, internalFormat, format, type, param);
      return {
        width: w, height: h, texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
        get read() { return fbo1; }, set read(v) { fbo1 = v; },
        get write() { return fbo2; }, set write(v) { fbo2 = v; },
        swap: function () { const t = fbo1; fbo1 = fbo2; fbo2 = t; },
      };
    }
    function resizeFBO(target, w, h, internalFormat, format, type, param) {
      const next = createFBO(w, h, internalFormat, format, type, param);
      copyProgram.bind();
      g.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
      blit(next);
      destroyFBO(target);
      return next;
    }
    function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
      if (target.width === w && target.height === h) return target;
      target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
      destroyFBO(target.write);
      target.write = createFBO(w, h, internalFormat, format, type, param);
      target.width = w; target.height = h;
      target.texelSizeX = 1 / w; target.texelSizeY = 1 / h;
      return target;
    }
    // A one-line headline is a very wide canvas, so the original sizing could
    // ask for textures wider than the GPU allows. Cap at the canvas's own size.
    const maxTex = g.getParameter(g.MAX_TEXTURE_SIZE);
    function getResolution(resolution) {
      const bw = g.drawingBufferWidth, bh = g.drawingBufferHeight;
      let aspectRatio = bw / bh;
      if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
      let min = Math.round(resolution);
      let max = Math.round(resolution * aspectRatio);
      const cap = Math.min(maxTex, Math.max(bw, bh));
      if (max > cap) { min = Math.max(1, Math.round((min * cap) / max)); max = cap; }
      return bw > bh ? { width: max, height: min } : { width: min, height: max };
    }

    let dye, velocity, divergence, curlFBO, pressureFBO;
    function initFramebuffers() {
      const simRes = getResolution(SIM_RESOLUTION);
      const dr = getResolution(dyeRes);
      const texType = halfFloatTexType;
      const filtering = supportLinearFiltering ? g.LINEAR : g.NEAREST;
      g.disable(g.BLEND);
      dye = dye
        ? resizeDoubleFBO(dye, dr.width, dr.height, formatRGBA.internalFormat, formatRGBA.format, texType, filtering)
        : createDoubleFBO(dr.width, dr.height, formatRGBA.internalFormat, formatRGBA.format, texType, filtering);
      velocity = velocity
        ? resizeDoubleFBO(velocity, simRes.width, simRes.height, formatRG.internalFormat, formatRG.format, texType, filtering)
        : createDoubleFBO(simRes.width, simRes.height, formatRG.internalFormat, formatRG.format, texType, filtering);
      if (divergence && divergence.width === simRes.width && divergence.height === simRes.height) return;
      destroyFBO(divergence);
      destroyFBO(curlFBO);
      if (pressureFBO) { destroyFBO(pressureFBO.read); destroyFBO(pressureFBO.write); }
      divergence = createFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, g.NEAREST);
      curlFBO = createFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, g.NEAREST);
      pressureFBO = createDoubleFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, g.NEAREST);
    }

    /* ---- the text mask: white glyphs drawn to a 2D canvas, uploaded as a texture ---- */
    const MASK_UNIT = 8;
    const maskCanvas = document.createElement("canvas");
    const maskTexture = g.createTexture();
    g.activeTexture(g.TEXTURE0 + MASK_UNIT);
    g.bindTexture(g.TEXTURE_2D, maskTexture);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);

    function paintMask(dpr) {
      const w = Math.max(1, canvas.width), h = Math.max(1, canvas.height);
      maskCanvas.width = w; maskCanvas.height = h;
      const ctx = maskCanvas.getContext("2d");
      const cs = getComputedStyle(host);
      const size = parseFloat(cs.fontSize) * dpr;
      ctx.font = cs.fontStyle + " " + cs.fontWeight + " " + size + "px " + cs.fontFamily;
      const ls = parseFloat(cs.letterSpacing);
      if (Number.isFinite(ls)) { try { ctx.letterSpacing = ls * dpr + "px"; } catch (e) { /* older browsers */ } }
      ctx.fillStyle = ctx.strokeStyle = "#fff";
      ctx.lineJoin = "round";
      ctx.lineWidth = size * FAUX_BOLD;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, w / 2, h / 2);
      ctx.strokeText(text, w / 2, h / 2);
      g.activeTexture(g.TEXTURE0 + MASK_UNIT);
      g.bindTexture(g.TEXTURE_2D, maskTexture);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, maskCanvas);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    }
    let maskKey = "";
    function syncMask(dpr) {
      const key = canvas.width + "|" + canvas.height + "|" + dpr;
      if (key === maskKey) return;
      maskKey = key;
      paintMask(dpr);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { maskKey = ""; });

    /* ---- dye color drifts through the palette ---- */
    let colorPhase = Math.random();
    function paletteAt(phase) {
      const scaled = phase * PALETTE.length;
      const i = Math.floor(scaled) % PALETTE.length;
      const a = parseColor(PALETTE[i], 0.5);
      const b = parseColor(PALETTE[(i + 1) % PALETTE.length], 0.5);
      const f = scaled - Math.floor(scaled);
      return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f };
    }

    const pointer = {
      texcoordX: 0, texcoordY: 0, prevTexcoordX: 0, prevTexcoordY: 0,
      deltaX: 0, deltaY: 0, moved: false, color: paletteAt(colorPhase), clientX: 0, clientY: 0,
    };

    function correctRadius(r) { const a = canvas.width / canvas.height; return a > 1 ? r * a : r; }
    function splat(x, y, dx, dy, c) {
      g.disable(g.BLEND);
      splatProgram.bind();
      g.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
      g.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
      g.uniform2f(splatProgram.uniforms.point, x, y);
      g.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
      g.uniform1f(splatProgram.uniforms.radius, correctRadius(SPLAT_RADIUS / 100));
      blit(velocity.write);
      velocity.swap();
      g.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
      g.uniform3f(splatProgram.uniforms.color, c.r, c.g, c.b);
      blit(dye.write);
      dye.swap();
    }
    function clickSplat() {
      const c = paletteAt(colorPhase);
      splat(pointer.texcoordX, pointer.texcoordY, 10 * (Math.random() - 0.5), 30 * (Math.random() - 0.5),
        { r: c.r * 10, g: c.g * 10, b: c.b * 10 });
    }

    /* ---- pointer (listens on window so the headline stays a normal link) ---- */
    let inside = false;
    function isInside(x, y) {
      const r = canvas.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }
    function texcoords(x, y) {
      const r = canvas.getBoundingClientRect();
      return { x: r.width > 0 ? (x - r.left) / r.width : 0, y: r.height > 0 ? 1 - (y - r.top) / r.height : 0 };
    }
    function correctDeltaX(d) { const a = canvas.width / canvas.height; return a < 1 ? d * a : d; }
    function correctDeltaY(d) { const a = canvas.width / canvas.height; return a > 1 ? d / a : d; }
    function leave() { if (!inside) return; inside = false; pointer.moved = false; }
    function enter(tc) {
      inside = true;
      pointer.prevTexcoordX = tc.x; pointer.prevTexcoordY = tc.y;
      pointer.deltaX = 0; pointer.deltaY = 0; pointer.moved = false;
      pointer.color = paletteAt(colorPhase);
    }
    window.addEventListener("pointermove", function (e) {
      if (!isInside(e.clientX, e.clientY)) { leave(); return; }
      const tc = texcoords(e.clientX, e.clientY);
      pointer.clientX = e.clientX; pointer.clientY = e.clientY;
      if (!inside) { enter(tc); pointer.texcoordX = tc.x; pointer.texcoordY = tc.y; return; }
      pointer.prevTexcoordX = pointer.texcoordX; pointer.prevTexcoordY = pointer.texcoordY;
      pointer.texcoordX = tc.x; pointer.texcoordY = tc.y;
      pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
      pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
      pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
    }, { passive: true });
    window.addEventListener("pointerdown", function (e) {
      if (!isInside(e.clientX, e.clientY)) { leave(); return; }
      const tc = texcoords(e.clientX, e.clientY);
      pointer.clientX = e.clientX; pointer.clientY = e.clientY;
      pointer.texcoordX = tc.x; pointer.texcoordY = tc.y;
      enter(tc);
      clickSplat();
    }, { passive: true });
    document.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);

    /* ---- simulation step + draw ---- */
    function step(dt) {
      g.disable(g.BLEND);
      curlProgram.bind();
      g.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      g.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
      blit(curlFBO);

      vorticityProgram.bind();
      g.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      g.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
      g.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1));
      g.uniform1f(vorticityProgram.uniforms.curl, CURL);
      g.uniform1f(vorticityProgram.uniforms.dt, dt);
      blit(velocity.write);
      velocity.swap();

      divergenceProgram.bind();
      g.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      g.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
      blit(divergence);

      clearProgram.bind();
      g.uniform1i(clearProgram.uniforms.uTexture, pressureFBO.read.attach(0));
      g.uniform1f(clearProgram.uniforms.value, PRESSURE);
      blit(pressureFBO.write);
      pressureFBO.swap();

      pressureProgram.bind();
      g.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      g.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
      for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
        g.uniform1i(pressureProgram.uniforms.uPressure, pressureFBO.read.attach(1));
        blit(pressureFBO.write);
        pressureFBO.swap();
      }

      gradientSubtractProgram.bind();
      g.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      g.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressureFBO.read.attach(0));
      g.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
      blit(velocity.write);
      velocity.swap();

      advectionProgram.bind();
      g.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      if (!supportLinearFiltering) g.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
      const velocityId = velocity.read.attach(0);
      g.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
      g.uniform1i(advectionProgram.uniforms.uSource, velocityId);
      g.uniform1f(advectionProgram.uniforms.dt, dt);
      g.uniform1f(advectionProgram.uniforms.dissipation, VELOCITY_DISSIPATION);
      blit(velocity.write);
      velocity.swap();

      if (!supportLinearFiltering) g.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
      g.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
      g.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
      g.uniform1f(advectionProgram.uniforms.dissipation, DENSITY_DISSIPATION);
      blit(dye.write);
      dye.swap();
    }

    const base = parseColor(BASE_COLOR, 1);
    function render() {
      g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
      g.enable(g.BLEND);
      displayProgram.bind();
      if (shading) g.uniform2f(displayProgram.uniforms.texelSize, 1 / g.drawingBufferWidth, 1 / g.drawingBufferHeight);
      g.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
      g.activeTexture(g.TEXTURE0 + MASK_UNIT);
      g.bindTexture(g.TEXTURE_2D, maskTexture);
      g.uniform1i(displayProgram.uniforms.uMask, MASK_UNIT);
      g.uniform4f(displayProgram.uniforms.uBase, base.r, base.g, base.b, 1);
      blit(null, true);
    }

    let lastUpdateTime = performance.now();
    let needsResize = true;
    let raf = 0;
    function frame() {
      if (g.isContextLost()) { raf = 0; return; }
      const now = performance.now();
      const dt = Math.min((now - lastUpdateTime) / 1000, 0.016666);
      lastUpdateTime = now;

      if (needsResize) {
        needsResize = false;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
        if (w > 0 && h > 0 && (!dye || canvas.width !== w || canvas.height !== h)) {
          canvas.width = w; canvas.height = h;
          initFramebuffers();
        }
      }
      if (!dye) { raf = requestAnimationFrame(frame); return; }   // not laid out yet
      syncMask(window.devicePixelRatio || 1);

      colorPhase = (colorPhase + dt * COLOR_SPEED) % 1;
      pointer.color = paletteAt(colorPhase);
      if (pointer.moved) {
        pointer.moved = false;
        if (inside) splat(pointer.texcoordX, pointer.texcoordY,
          pointer.deltaX * SPLAT_FORCE, pointer.deltaY * SPLAT_FORCE, pointer.color);
      }
      step(dt);
      render();
      raf = requestAnimationFrame(frame);
    }
    function start() { if (raf) return; lastUpdateTime = performance.now(); raf = requestAnimationFrame(frame); }
    function stop() { if (!raf) return; cancelAnimationFrame(raf); raf = 0; }

    new ResizeObserver(function () { needsResize = true; maskKey = ""; }).observe(canvas);

    // pause off-screen or in a hidden tab
    let onScreen = true;
    function sync() { if (onScreen && !document.hidden) start(); else stop(); }
    new IntersectionObserver(function (entries) {
      onScreen = entries[0] ? entries[0].isIntersecting : true;
      sync();
    }).observe(canvas);
    document.addEventListener("visibilitychange", sync);

    host.classList.add("fluid--on");
    start();
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-fluid-text]"), mount);
})();
