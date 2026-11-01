/*! FormFlow embed SDK v2.1.0 | hand-written ES2017 IIFE; keep in sync with src/sdk/embed/types.d.ts and README.md */
(function (global) {
  "use strict";
  var VERSION = "2.1.0";
  var doc = global.document;
  if (!doc || (global.FormFlow && global.FormFlow.version === VERSION)) return;

  var currentScript = doc.currentScript;
  var defaults = { baseUrl: "", workspace: "", autoResize: true };
  try {
    defaults.baseUrl = new URL(currentScript && currentScript.src ? currentScript.src : global.location.href).origin;
  } catch (e) { defaults.baseUrl = global.location.origin; }
  if (currentScript) {
    if (currentScript.getAttribute("data-base-url")) defaults.baseUrl = currentScript.getAttribute("data-base-url");
    if (currentScript.getAttribute("data-workspace")) defaults.workspace = currentScript.getAttribute("data-workspace");
  }

  var MODES = ["inline", "popup", "modal", "drawer", "fullscreen", "floating", "popover", "slider"];
  var widgets = [];          // live widgets (for the message router)
  var activeOverlay = null;  // widget with an open overlay (FormFlow.close())
  var scanned = typeof WeakSet === "function" ? new WeakSet() : null;

  function h(tag, attrs, style) {
    var n = doc.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (style) Object.assign(n.style, style);
    return n;
  }
  function baseOrigin(baseUrl) { try { return new URL(baseUrl).origin; } catch (e) { return ""; } }
  function css(v, fallback) { return typeof v === "number" ? v + "px" : v || fallback; }
  function merge() { return Object.assign.apply(null, [{}].concat([].slice.call(arguments))); }
  function noop() {}

  /* ---------- prefill sources on the host page ---------- */
  // prefillFromUrl: true (every host query param) | ["email","plan"] | { fieldId: "paramName" }
  function fromUrl(spec) {
    var out = {};
    if (!spec) return out;
    var cur = new URLSearchParams(global.location.search);
    if (spec === true || Array.isArray(spec)) {
      cur.forEach(function (v, k) { if (/^[A-Za-z][\w-]*$/.test(k) && (spec === true || spec.indexOf(k) >= 0)) out[k] = v; });
    } else if (typeof spec === "object") {
      Object.keys(spec).forEach(function (fid) { var v = cur.get(spec[fid]); if (v !== null) out[fid] = v; });
    }
    return out;
  }
  // prefillFromDataLayer: { fieldId: "dataLayerKey" } (dotted paths allowed). The newest dataLayer entry that has the key wins.
  function fromDataLayer(map) {
    var out = {};
    var dl = global.dataLayer;
    if (!map || !Array.isArray(dl)) return out;
    Object.keys(map).forEach(function (fid) {
      var path = String(map[fid]).split(".");
      for (var i = dl.length - 1; i >= 0; i--) {
        var cur = dl[i], found = true;
        for (var j = 0; j < path.length; j++) {
          if (cur && typeof cur === "object" && path[j] in cur) cur = cur[path[j]]; else { found = false; break; }
        }
        if (found && cur !== null && typeof cur !== "object") { out[fid] = cur; break; }
      }
    });
    return out;
  }

  /* ---------- theme-matched loading placeholder ---------- */
  var themeCache = {}, styled = false;
  function themeFor(w, cb) {
    var key = w.origin + "/" + w.slug;
    if (themeCache[key]) return cb(themeCache[key]);
    fetch(w.opts.baseUrl + "/api/v1/public/forms/" + encodeURIComponent(w.slug), { credentials: "omit", mode: "cors" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { var c = j && j.data && j.data.theme && j.data.theme.colors; if (c) { themeCache[key] = c; cb(c); } })
      .catch(noop);
  }
  function addPlaceholder(w, parent) {
    if (w.opts.placeholder === false) return;
    if (!styled) {
      styled = true;
      var st = h("style");
      st.textContent = "@keyframes ffpulse{0%,100%{opacity:.35}50%{opacity:.85}}@media (prefers-reduced-motion:reduce){[data-formflow-placeholder] i{animation:none!important}}";
      doc.head.appendChild(st);
    }
    var ph = h("div", { "aria-hidden": "true", "data-formflow-placeholder": "" }, {
      position: "absolute", inset: "0", background: "#fff", display: "flex", flexDirection: "column", justifyContent: "center", gap: "16px",
      padding: "8% 12%", zIndex: "1", transition: "opacity .25s ease", pointerEvents: "none", boxSizing: "border-box",
    });
    var bars = [["46%", "22px"], ["78%", "44px"], ["30%", "44px"]].map(function (d) {
      var b = h("i", null, { display: "block", width: d[0], height: d[1], borderRadius: "8px", background: "#cbd5e1", animation: "ffpulse 1.4s ease-in-out infinite" });
      ph.appendChild(b);
      return b;
    });
    parent.appendChild(ph);
    var gone = false;
    w.hidePlaceholder = function () { if (gone) return; gone = true; ph.style.opacity = "0"; global.setTimeout(function () { ph.remove(); }, 300); };
    global.setTimeout(w.hidePlaceholder, 10000);
    themeFor(w, function (c) {
      if (c.background) ph.style.background = c.background;
      bars.forEach(function (b) { b.style.background = c.muted || c.border || c.text || "#cbd5e1"; b.style.opacity = ".3"; });
    });
  }

  /* ---------- identity (uid, signature, attributes, PostHog link) ---------- */
  // Options: uid, uidSignature (HMAC from YOUR server), attributes, posthog:true (read window.posthog), posthogSessionId, posthogDistinctId.
  function identity(o) {
    var out = [];
    var uid = o.uid != null ? o.uid : sv.userId;
    if (uid != null) out.push(["uid", String(uid)]);
    if (o.uidSignature) out.push(["uid_sig", String(o.uidSignature)]);
    var attrs = merge(sv.attrs || {}, o.attributes || {});
    Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) out.push(["attrs." + k, String(attrs[k])]); });
    var ph = o.posthog ? global.posthog : null, sid = o.posthogSessionId, did = o.posthogDistinctId;
    try {
      if (ph) {
        if (!sid && ph.get_session_id) sid = ph.get_session_id();
        if (!did && ph.get_distinct_id) did = ph.get_distinct_id();
      }
    } catch (e) { /* PostHog not ready */ }
    if (sid) out.push(["ph_session", String(sid)]);
    if (did) out.push(["ph_distinct", String(did)]);
    return out;
  }

  /* ---------- URL building ---------- */
  function buildSrc(slug, o, extra) {
    var u = new URL(o.baseUrl.replace(/\/$/, "") + "/embed/" + encodeURIComponent(slug));
    var p = u.searchParams;
    p.set("origin", global.location.origin);
    p.set("sdk", VERSION);
    var put = function (prefix, obj) {
      Object.keys(obj || {}).forEach(function (k) {
        var v = obj[k];
        if (v !== undefined && v !== null) p.set(prefix + k, String(v));
      });
    };
    identity(o).forEach(function (kv) { p.set(kv[0], kv[1]); });
    put("prefill.", o.prefill);
    put("hidden.", o.hidden);
    put("respondent.", o.respondent);
    put("prefill.", fromUrl(o.prefillFromUrl));
    put("prefill.", fromDataLayer(o.prefillFromDataLayer));
    var pass = o.transitiveSearchParams !== undefined ? o.transitiveSearchParams : o.passQueryParams;
    if (pass) {
      var cur = new URLSearchParams(global.location.search);
      cur.forEach(function (v, k) {
        if (k === "origin" || k === "sdk" || /^(prefill|hidden|respondent)\./.test(k)) return;
        if (pass === true || (Array.isArray(pass) && pass.indexOf(k) >= 0)) p.set(k, v);
      });
    }
    if (extra && extra.close) p.set("close", "1");
    return u.toString();
  }

  /* ---------- messaging ---------- */
  function onMessage(ev) {
    var d = ev.data;
    if (!d || d.source !== "formflow" || typeof d.type !== "string") return;
    for (var i = 0; i < widgets.length; i++) {
      var w = widgets[i];
      if (!w.iframe || ev.source !== w.iframe.contentWindow) continue;
      if (ev.origin !== w.origin) return; // strict origin check
      w.handle(d);
      return;
    }
  }
  global.addEventListener("message", onMessage);

  function makeWidget(slug, o) {
    var w = {
      slug: slug, opts: o, origin: baseOrigin(o.baseUrl), iframe: null, overlay: null, destroyed: false,
      handle: function (d) {
        var data = d.data || {};
        switch (d.type) {
          case "ready": if (w.hidePlaceholder) w.hidePlaceholder(); (o.onReady || noop)(data); break;
          case "resize":
            if (o.autoResize !== false && typeof data.height === "number") w.resize(Math.max(120, Math.min(data.height, 20000)));
            break;
          case "progress": (o.onProgress || noop)(data); break;
          case "submit":
            (o.onSubmit || noop)(data);
            if (o.autoClose && w.overlay) global.setTimeout(function () { w.close(); }, typeof o.autoClose === "number" ? o.autoClose : 3000);
            break;
          case "error": (o.onError || noop)(data); break;
          // the visitor is in a test's holdout: no form. Without a handler the embed is removed (inline) or closed (overlays).
          case "holdout":
            if (o.onHoldout) o.onHoldout({ experimentId: d.experimentId || data.experimentId, redirectUrl: data.redirectUrl });
            else if (w.overlay) w.close(); else w.destroy();
            break;
          case "close": w.close(); break;
        }
      },
      resize: noop, close: noop, open: noop, destroy: noop, hidePlaceholder: null,
    };
    widgets.push(w);
    return w;
  }

  function makeFrame(w, close) {
    var f = h("iframe", {
      src: buildSrc(w.slug, w.opts, { close: close }), title: w.opts.title || "Form", loading: "lazy",
      allow: "geolocation; camera; clipboard-write", referrerpolicy: "strict-origin-when-cross-origin",
    }, { border: "0", width: "100%", display: "block", background: "transparent", colorScheme: "normal" });
    w.iframe = f;
    return f;
  }

  /* ---------- overlay (modal, popup, drawer, fullscreen, floating panel, popover) ---------- */
  var FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,iframe,[tabindex]:not([tabindex="-1"])';

  function openOverlay(w, mode) {
    if (w.overlay) return;
    var s = w.opts.styles || {};
    var returnFocus = doc.activeElement;
    var panelMode = mode === "floating" || mode === "popover";
    var slider = mode === "slider";
    var left = slider && s.side === "left";
    var label = w.opts.title || "Form";
    var frame = makeFrame(w, true);

    var backdrop = h("div", { "data-formflow-overlay": mode }, {
      position: "fixed", zIndex: "2147483000", inset: panelMode ? "auto" : "0",
      background: panelMode ? "transparent" : mode === "modal" ? "rgba(15,17,21,.6)" : mode === "fullscreen" ? "#fff" : slider ? "rgba(15,17,21,.45)" : "rgba(15,17,21,.35)",
      display: "flex", alignItems: "center", justifyContent: mode === "drawer" || (slider && !left) ? "flex-end" : slider ? "flex-start" : "center",
      pointerEvents: panelMode ? "none" : "auto",
    });
    var pos = s.position === "bottom-left" ? { left: "20px" } : { right: "20px" };
    var box = h("div", { role: "dialog", "aria-label": label, tabindex: "-1" }, {
      position: "relative", background: "#fff", overflow: "hidden", pointerEvents: "auto", boxShadow: "0 24px 64px rgba(0,0,0,.35)", outline: "none",
      transition: "transform .22s ease, opacity .22s ease", opacity: "0",
    });
    if (mode !== "floating" && mode !== "popover") box.setAttribute("aria-modal", "true");
    if (mode === "fullscreen") Object.assign(box.style, { width: "100vw", height: "100dvh", borderRadius: "0", boxShadow: "none" });
    else if (slider) Object.assign(box.style, { width: css(s.width, "min(520px,100vw)"), height: "100dvh", borderRadius: left ? "0 16px 16px 0" : "16px 0 0 16px", transform: left ? "translateX(-100%)" : "translateX(100%)", transition: "transform .3s cubic-bezier(.2,.8,.2,1), opacity .2s ease" });
    else if (mode === "drawer") Object.assign(box.style, { width: css(s.width, "min(480px,100vw)"), height: "100dvh", borderRadius: "0", transform: "translateX(24px)" });
    else if (panelMode) Object.assign(box.style, merge({ position: "fixed", bottom: "84px", width: css(s.width, "min(400px,calc(100vw - 24px))"), height: css(s.height, "min(640px,calc(100dvh - 110px))"), borderRadius: "16px", transform: "translateY(12px)" }, pos));
    else Object.assign(box.style, { width: css(s.width, mode === "modal" ? "min(720px,calc(100vw - 24px))" : "min(520px,calc(100vw - 24px))"), height: css(s.height, "min(760px,92dvh)"), borderRadius: "16px", transform: "translateY(12px)" });
    if (mode === "popover") Object.assign(box.style, { bottom: "20px" });
    frame.style.height = "100%";

    var closeBtn = h("button", { type: "button", "aria-label": "Close form" }, {
      position: "absolute", top: "8px", right: "8px", zIndex: "2", width: "44px", height: "44px", borderRadius: "50%", border: "0",
      background: "rgba(15,17,21,.65)", color: "#fff", fontSize: "24px", lineHeight: "1", cursor: "pointer",
    });
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", function () { w.close(); });

    // Focus sentinels keep Tab inside the dialog even while focus is inside the iframe.
    var first = h("span", { tabindex: "0", "aria-hidden": "true" });
    var last = h("span", { tabindex: "0", "aria-hidden": "true" });
    first.addEventListener("focus", function () { closeBtn.focus(); });
    last.addEventListener("focus", function () { closeBtn.focus(); });
    box.appendChild(first); box.appendChild(closeBtn); box.appendChild(frame); box.appendChild(last);
    backdrop.appendChild(box);
    doc.body.appendChild(backdrop);

    var prevOverflow = doc.body.style.overflow;
    if (!panelMode) doc.body.style.overflow = "hidden";
    addPlaceholder(w, box);
    if (mode === "modal" || mode === "popup" || slider) backdrop.addEventListener("mousedown", function (e) { if (e.target === backdrop) w.close(); });
    var onKey = function (e) {
      if (e.key === "Escape") { e.stopPropagation(); w.close(); return; }
      if (e.key === "Tab" && !panelMode) {
        var items = [].slice.call(box.querySelectorAll(FOCUSABLE)).filter(function (n) { return n !== first && n !== last; });
        if (!items.length) { e.preventDefault(); return; }
        var active = doc.activeElement;
        if (e.shiftKey && (active === items[0] || active === box)) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && active === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
      }
    };
    doc.addEventListener("keydown", onKey, true);

    w.overlay = backdrop;
    activeOverlay = w;
    global.requestAnimationFrame(function () { box.style.opacity = "1"; box.style.transform = "none"; });
    (panelMode ? closeBtn : box).focus();

    w.resize = function (px) {
      // Dialogs size to content up to the viewport; fixed heights from styles win.
      if (s.height || mode === "fullscreen" || mode === "drawer" || slider) return;
      box.style.height = Math.min(px, Math.round(global.innerHeight * 0.92)) + "px";
    };
    w.close = function () {
      if (!w.overlay) return;
      doc.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      w.overlay = null; w.iframe = null;
      if (!panelMode) doc.body.style.overflow = prevOverflow;
      if (activeOverlay === w) activeOverlay = null;
      try { if (returnFocus && returnFocus.focus) returnFocus.focus(); } catch (e) { /* element gone */ }
      (w.opts.onClose || noop)();
    };
  }

  /* ---------- widgets ---------- */
  function normalize(opts) {
    var o = merge(defaults, opts || {});
    o.baseUrl = (o.baseUrl || defaults.baseUrl).replace(/\/$/, "");
    if (MODES.indexOf(o.mode) < 0) o.mode = "inline";
    return o;
  }

  function createWidget(el, slug, opts) {
    var o = normalize(opts);
    if (!baseOrigin(o.baseUrl)) throw new Error("FormFlow: invalid baseUrl");
    var w = makeWidget(slug, o);
    var s = o.styles || {};
    var color = s.buttonColor || "#1d4ed8";

    function button(fixed) {
      var b = h("button", { type: "button", "aria-haspopup": "dialog" }, {
        font: "600 16px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif", color: "#fff", background: color, border: "0", cursor: "pointer",
        minHeight: "48px", padding: "12px 22px", borderRadius: fixed ? "999px" : "10px",
        boxShadow: fixed ? "0 6px 20px rgba(0,0,0,.3)" : "none",
      });
      if (fixed) Object.assign(b.style, merge({ position: "fixed", bottom: "20px", zIndex: "2147482999" }, s.position === "bottom-left" ? { left: "20px" } : { right: "20px" }));
      b.textContent = o.buttonText || (fixed ? "Feedback" : "Open form");
      return b;
    }

    if (o.mode === "inline") {
      var wrap = h("div", null, { position: "relative" });
      var f = makeFrame(w, false);
      f.style.height = css(s.height, "600px");
      if (s.width) f.style.width = css(s.width);
      wrap.appendChild(f);
      addPlaceholder(w, wrap);
      el.appendChild(wrap);
      w.resize = function (px) { if (!s.height) f.style.height = px + "px"; };
      w.destroy = function () { wrap.remove(); drop(w); };
      return w;
    }
    var cleanups = [];
    var useBubble = !!o.launcher && (o.mode === "popover" || o.mode === "floating");
    if (o.mode === "popover" && !o.launcher && !o.trigger) {
      // v1 behavior: a popover opens straight away (used by in-product surveys)
      w.open = function () { openOverlay(w, "popover"); };
      w.destroy = function () { w.close(); drop(w); };
      w.open();
      return w;
    }
    var floating = o.mode === "floating";
    var btn = useBubble ? bubble(o, w) : button(floating);
    var showButton = !(o.trigger && !o.launcher && o.mode === "popover");
    if (showButton && !useBubble) (floating ? doc.body : el).appendChild(btn);
    btn.setAttribute("aria-expanded", "false");
    w.open = function () { openOverlay(w, o.mode); btn.setAttribute("aria-expanded", "true"); };
    btn.addEventListener("click", function () { if (w.overlay) w.close(); else w.open(); });
    // keep aria-expanded in sync however the overlay closes (Escape, X, FormFlow.close())
    var watch = new MutationObserver(function () { btn.setAttribute("aria-expanded", w.overlay ? "true" : "false"); });
    watch.observe(doc.body, { childList: true });
    if (o.trigger) cleanups.push(armTriggers(w, o.trigger));
    w.destroy = function () { w.close(); btn.remove(); watch.disconnect(); cleanups.forEach(function (c) { c(); }); drop(w); };
    return w;
  }
  /* ---------- chat-bubble launcher ---------- */
  var ICONS = {
    chat: "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    question: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 15v-2m0-3c0-2 3-2 3-4.5a3 3 0 0 0-6 0",
    clipboard: "M9 2h6v3H9zM6 4h3v1h6V4h3v18H6z",
    star: "M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z",
  };
  // launcher: { icon: "chat" | "question" | "clipboard" | "star" | "<https image url>", tooltip, color, position }
  function bubble(o, w) {
    var l = o.launcher === true ? {} : o.launcher, s = o.styles || {};
    var color = l.color || s.buttonColor || "#1d4ed8";
    var pos = (l.position || s.position) === "bottom-left" ? { left: "20px" } : { right: "20px" };
    var wrapEl = h("div", null, merge({ position: "fixed", bottom: "20px", zIndex: "2147482999" }, pos));
    var b = h("button", { type: "button", "aria-haspopup": "dialog", "aria-label": l.label || l.tooltip || o.buttonText || "Open form" }, {
      width: "56px", height: "56px", borderRadius: "50%", border: "0", background: color, color: "#fff", cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 20px rgba(0,0,0,.3)", padding: "0",
    });
    var icon = l.icon || "chat";
    if (/^https:\/\//.test(icon)) {
      var img = h("img", { src: icon, alt: "", width: "28", height: "28" }, { borderRadius: "4px" });
      b.appendChild(img);
    } else {
      b.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (ICONS[icon] || ICONS.chat) + '"/></svg>';
    }
    wrapEl.appendChild(b);
    if (l.tooltip) {
      var tip = h("div", { role: "tooltip" }, Object.assign({
        position: "absolute", bottom: "8px", whiteSpace: "nowrap", font: "500 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
        background: "#0f172a", color: "#fff", padding: "9px 13px", borderRadius: "10px", opacity: "0", pointerEvents: "none",
        transition: "opacity .15s ease", boxShadow: "0 4px 14px rgba(0,0,0,.25)",
      }, (l.position || s.position) === "bottom-left" ? { left: "68px" } : { right: "68px" }));
      tip.textContent = l.tooltip;
      wrapEl.appendChild(tip);
      var showTip = function () { if (!w.overlay) tip.style.opacity = "1"; };
      var hideTip = function () { tip.style.opacity = "0"; };
      b.addEventListener("mouseenter", showTip); b.addEventListener("focus", showTip);
      b.addEventListener("mouseleave", hideTip); b.addEventListener("blur", hideTip); b.addEventListener("click", hideTip);
    }
    // removing the button removes its shell (tooltip included)
    var origRemove = b.remove.bind(b);
    b.remove = function () { origRemove(); wrapEl.remove(); };
    doc.body.appendChild(wrapEl);
    return b;
  }

  /* ---------- popup triggers: exit intent, scroll depth, delay ---------- */
  // trigger: { exitIntent?: true, scrollPercent?: 0-100, delay?: seconds, once?: boolean (default true) }
  function armTriggers(w, t) {
    var key = "ff:trig:" + w.slug, fired = false, offs = [];
    var once = t.once !== false;
    try { if (once && global.sessionStorage.getItem(key)) return noop; } catch (e) { /* storage blocked */ }
    function fire() {
      if (fired || w.overlay || activeOverlay) return;
      fired = true;
      try { if (once) global.sessionStorage.setItem(key, "1"); } catch (e) { /* storage blocked */ }
      offs.forEach(function (f) { f(); });
      w.open();
    }
    if (t.exitIntent) {
      var onOut = function (e) { if (!e.relatedTarget && e.clientY <= 0) fire(); };
      doc.addEventListener("mouseout", onOut);
      offs.push(function () { doc.removeEventListener("mouseout", onOut); });
    }
    if (typeof t.scrollPercent === "number") {
      var onScroll = function () {
        var el = doc.documentElement, max = el.scrollHeight - global.innerHeight;
        if (max > 0 && ((global.pageYOffset || el.scrollTop) / max) * 100 >= t.scrollPercent) fire();
      };
      global.addEventListener("scroll", onScroll, { passive: true });
      offs.push(function () { global.removeEventListener("scroll", onScroll); });
    }
    if (typeof t.delay === "number") {
      var id = global.setTimeout(fire, t.delay * 1000);
      offs.push(function () { global.clearTimeout(id); });
    }
    return function () { fired = true; offs.forEach(function (f) { f(); }); };
  }

  function drop(w) { var i = widgets.indexOf(w); if (i >= 0) widgets.splice(i, 1); }

  function open(slug, opts) {
    var o = merge({ mode: "modal" }, opts || {});
    if (o.mode === "inline") o.mode = "modal";
    if (activeOverlay) activeOverlay.close();
    var w = createWidget(doc.body, slug, o);
    if (o.mode !== "popover") w.open();
    return w;
  }
  function close() { if (activeOverlay) activeOverlay.close(); }

  /* ---------- auto-scan ---------- */
  function readAttrs(el) {
    var o = { prefill: {}, hidden: {} };
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      var m = /^data-(prefill|hidden)-(.+)$/.exec(a.name);
      if (m) o[m[1]][m[2]] = a.value; // note: HTML lower-cases attribute names, so field ids must be lowercase here
    }
    var g = function (n) { return el.getAttribute("data-" + n); };
    if (g("mode")) o.mode = g("mode");
    if (g("button-text")) o.buttonText = g("button-text");
    if (g("base-url")) o.baseUrl = g("base-url");
    if (g("pass-query-params") === "true") o.passQueryParams = true;
    if (g("transitive-search-params") === "true") o.transitiveSearchParams = true;
    if (g("prefill-from-url") === "true") o.prefillFromUrl = true;
    if (g("auto-close")) o.autoClose = Number(g("auto-close")) || true;
    if (g("placeholder") === "false") o.placeholder = false;
    if (g("launcher-icon") || g("launcher-tooltip")) o.launcher = { icon: g("launcher-icon") || undefined, tooltip: g("launcher-tooltip") || undefined };
    if (g("trigger-exit-intent") === "true" || g("trigger-scroll") || g("trigger-delay")) {
      o.trigger = {};
      if (g("trigger-exit-intent") === "true") o.trigger.exitIntent = true;
      if (g("trigger-scroll")) o.trigger.scrollPercent = Number(g("trigger-scroll"));
      if (g("trigger-delay")) o.trigger.delay = Number(g("trigger-delay"));
    }
    o.styles = {};
    if (g("width")) o.styles.width = g("width");
    if (g("height")) o.styles.height = g("height");
    if (g("button-color")) o.styles.buttonColor = g("button-color");
    return o;
  }
  function scan(root, extra) {
    [].slice.call((root || doc).querySelectorAll("[data-formflow]")).forEach(function (el) {
      if (scanned ? scanned.has(el) : el.__ffInit) return;
      scanned ? scanned.add(el) : (el.__ffInit = true);
      var slug = el.getAttribute("data-formflow");
      if (slug) createWidget(el, slug, merge(extra || {}, readAttrs(el)));
    });
  }

  /* ---------- in-product surveys ---------- */
  var sv = { userId: null, attrs: {}, rules: null, started: false, shown: false, firedEvents: {}, delayTimers: [] };

  function cmp(op, actual, value) {
    var isEmpty = actual === undefined || actual === null || actual === "";
    var a = actual, n = Number(actual), v = value;
    switch (op) {
      case "eq": return String(a) === String(v);
      case "neq": return String(a) !== String(v);
      case "gt": return n > Number(v);
      case "gte": return n >= Number(v);
      case "lt": return n < Number(v);
      case "lte": return n <= Number(v);
      case "contains": return !isEmpty && String(a).indexOf(String(v)) >= 0;
      case "not_contains": return isEmpty || String(a).indexOf(String(v)) < 0;
      case "starts_with": return !isEmpty && String(a).indexOf(String(v)) === 0;
      case "ends_with": return !isEmpty && String(a).slice(-String(v).length) === String(v);
      case "is_empty": return isEmpty;
      case "is_not_empty": return !isEmpty;
      case "includes_any": return Array.isArray(v) && v.indexOf(String(a)) >= 0;
      case "includes_none": return !Array.isArray(v) || v.indexOf(String(a)) < 0;
      case "before": return new Date(a) < new Date(v);
      case "after": return new Date(a) > new Date(v);
      default: return false;
    }
  }
  function audienceMatches(c) {
    if (!c) return true;
    if (c.type === "group") {
      var res = (c.conditions || []).map(audienceMatches);
      return c.combinator === "or" ? res.some(Boolean) : res.every(Boolean);
    }
    var src = c.source || {}, actual;
    if (src.kind === "respondent") actual = src.attribute === "id" ? sv.userId : sv.attrs[src.attribute];
    else if (src.kind === "url_param") actual = new URLSearchParams(global.location.search).get(src.name);
    else if (src.kind === "now") actual = new Date().toISOString();
    else return false;
    return cmp(c.operator, actual, c.value);
  }
  function lastKey(slug) { return "ff:last:" + slug; }
  function recentlyShown(slug, days) {
    try { var t = Number(global.localStorage.getItem(lastKey(slug))); return t && Date.now() - t < days * 86400000; } catch (e) { return false; }
  }
  function show(rule) {
    if (sv.shown || activeOverlay) return;
    if (recentlyShown(rule.formSlug, rule.recontactDays)) return;
    if (!(Math.random() < rule.sampleRate)) return;
    if (!audienceMatches(rule.audience)) return;
    sv.shown = true;
    try { global.localStorage.setItem(lastKey(rule.formSlug), String(Date.now())); } catch (e) { /* private mode */ }
    var respondent = merge(sv.attrs, sv.userId ? { id: sv.userId } : {});
    open(rule.formSlug, { mode: "popover", respondent: respondent, onClose: function () { sv.shown = false; } });
  }
  function pathMatches(v) { return !v || global.location.pathname.indexOf(v) >= 0; }
  function runRules(kind, name) {
    (sv.rules || []).forEach(function (r) {
      var t = r.trigger || {};
      if (t.type === "page_view" && kind === "page_view" && pathMatches(t.value)) show(r);
      else if (t.type === "event" && kind === "event" && t.value === name) show(r);
    });
  }
  function startSurveys(o) {
    if (sv.started || !o.workspace) return;
    sv.started = true;
    var base = (o.baseUrl || defaults.baseUrl).replace(/\/$/, "");
    fetch(base + "/api/v1/public/targeting?workspace=" + encodeURIComponent(o.workspace), { credentials: "omit", mode: "cors" })
      .then(function (r) { return r.ok ? r.json() : { data: { rules: [] } }; })
      .then(function (j) {
        sv.rules = (j.data && j.data.rules) || [];
        runRules("page_view");
        Object.keys(sv.firedEvents).forEach(function (e) { runRules("event", e); }); // events tracked before rules arrived
        sv.rules.forEach(function (r) {
          if (r.trigger && r.trigger.type === "delay") sv.delayTimers.push(global.setTimeout(function () { show(r); }, (Number(r.trigger.value) || 0) * 1000));
        });
      })
      .catch(noop);
  }

  /* ---------- public API ---------- */
  var FormFlow = {
    version: VERSION,
    init: function (opts) {
      opts = opts || {};
      if (opts.baseUrl) defaults.baseUrl = opts.baseUrl;
      if (opts.workspace) defaults.workspace = opts.workspace;
      var run = function () { scan(doc, opts.widget); startSurveys(merge(defaults, opts)); };
      if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", run, { once: true }); else run();
    },
    open: open,
    close: close,
    createWidget: createWidget,
    identify: function (userId, attributes) {
      sv.userId = userId == null ? null : String(userId);
      sv.attrs = merge(attributes || {});
    },
    /** Ask the server whether to show an onboarding flow. Resolves { show, experimentId, variantId, formId, slug, versionId, reason, definition? }; rejects on network errors (fall back to your default flow). */
    decide: function (opts) {
      opts = opts || {};
      var base = (opts.baseUrl || defaults.baseUrl).replace(/\/$/, "");
      var body = { entry: opts.entry, uid: opts.uid, uid_sig: opts.uidSignature, attributes: opts.attributes || {} };
      identity(opts).forEach(function (kv) { if (kv[0] === "ph_session" || kv[0] === "ph_distinct") body[kv[0]] = kv[1]; });
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      var t = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeoutMs || 8000) : null;
      return fetch(base + "/api/v1/public/onboarding/decide", { method: "POST", credentials: "omit", mode: "cors", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error("decide " + r.status); return r.json(); })
        .then(function (j) { return j && j.data ? j.data : j; })
        .then(function (d) { if (t) clearTimeout(t); return d; }, function (e) { if (t) clearTimeout(t); throw e; });
    },
    track: function (event) {
      if (!sv.rules) { sv.firedEvents[event] = true; return; }
      runRules("event", event);
    },
  };
  global.FormFlow = FormFlow;

  if (!currentScript || currentScript.getAttribute("data-auto-init") !== "false") FormFlow.init();
})(typeof window !== "undefined" ? window : this);
