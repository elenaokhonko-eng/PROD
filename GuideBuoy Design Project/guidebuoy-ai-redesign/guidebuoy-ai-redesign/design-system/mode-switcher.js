/* ==========================================================================
   GuideBuoy AI — Emotional-state mode switcher (Steady / Quiet / Grounding)
   --------------------------------------------------------------------------
   - Present on EVERY screen (include the header partial everywhere).
   - One tap, instant global switch, no reload, no confirmation.
   - Persisted: localStorage for anonymous users; on sign-in, mirror the
     value into the account profile (see MIGRATION.md).
   - Grounding = full-screen calm canvas; pauses (never cancels) the task.
   - Announces changes to screen readers.
   ========================================================================== */
(function () {
  "use strict";

  var MODES = ["steady", "quiet", "grounding"];
  var STORAGE_KEY = "gb-sensory-mode";
  var root = document.documentElement;
  var previousMode = "steady";

  function storedMode() {
    try {
      var m = localStorage.getItem(STORAGE_KEY);
      return MODES.indexOf(m) !== -1 ? m : "steady";
    } catch (e) { return "steady"; }
  }

  function persistMode(mode) {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) {}
  }

  function announce(msg) {
    var region = document.getElementById("gb-mode-announcer");
    if (region) {
      region.textContent = "";
      window.setTimeout(function () { region.textContent = msg; }, 30);
    }
  }

  function ensureGroundingOverlay() {
    var overlay = document.getElementById("gb-grounding");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "gb-grounding";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Take a moment");
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="gb-breath" aria-hidden="true"></div>' +
      '<p class="gb-breath-cue">Breathe in… hold… breathe out…</p>' +
      '<p class="gb-grounding-text">Take a moment. There is no rush.</p>' +
      '<p class="gb-grounding-sub">Everything you have done is saved. It will be exactly where you left it.</p>' +
      '<div class="gb-grounding-actions">' +
      '  <button type="button" id="gb-grounding-continue" class="bg-primary text-on-primary px-6 py-3 rounded-lg font-bold hover:bg-primary-deep transition-colors duration-200">Continue when ready</button>' +
      '  <button type="button" id="gb-grounding-exit" class="text-text-slate border border-border-fog px-6 py-3 rounded-lg hover:bg-tint-sand transition-colors duration-200">Save and exit</button>' +
      "</div>";
    document.body.appendChild(overlay);

    overlay.querySelector("#gb-grounding-continue").addEventListener("click", function () {
      setMode(previousMode, { fromGrounding: true });
      announce("Display changed back to " + previousMode + " mode. Welcome back.");
    });
    overlay.querySelector("#gb-grounding-exit").addEventListener("click", function () {
      /* All work is already saved client-side / server-side per product rules.
         Replace this location with your safe-exit route if different. */
      window.location.href = "home.html";
    });
    return overlay;
  }

  function setMode(mode, opts) {
    opts = opts || {};
    if (MODES.indexOf(mode) === -1) mode = "steady";

    if (mode === "grounding") {
      previousMode = root.getAttribute("data-sensory") || "steady";
      if (previousMode === "grounding") previousMode = "steady";
      var overlay = ensureGroundingOverlay();
      overlay.hidden = false;
      document.body.style.overflow = "hidden";
      var btn = overlay.querySelector("#gb-grounding-continue");
      if (btn) btn.focus();
      announce("Grounding mode. Take a moment. Your work is saved.");
    } else {
      root.setAttribute("data-sensory", mode);
      var ov = document.getElementById("gb-grounding");
      if (ov) ov.hidden = true;
      document.body.style.overflow = "";
      if (!opts.silent) announce("Display changed to " + mode + " mode.");
    }

    persistMode(mode);
    syncSwitchUI(mode === "grounding" ? "grounding" : mode);
  }

  function syncSwitchUI(active) {
    var btns = document.querySelectorAll(".gb-mode-switch button[data-mode]");
    Array.prototype.forEach.call(btns, function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-mode") === active ? "true" : "false");
    });
  }

  function initSwitches() {
    var btns = document.querySelectorAll(".gb-mode-switch button[data-mode]");
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener("click", function () {
        setMode(b.getAttribute("data-mode"));
      });
    });
  }

  function init() {
    var mode = storedMode();
    if (mode === "grounding") mode = "steady"; /* never restore into crisis canvas */
    /* First-visit hint: users who prefer reduced motion start in Quiet mode */
    try {
      if (!localStorage.getItem(STORAGE_KEY) &&
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        mode = "quiet";
      }
    } catch (e) {}
    root.setAttribute("data-sensory", mode);
    initSwitches();
    syncSwitchUI(mode);
    ensureGroundingOverlay();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* Public API for the app shell */
  window.GBMode = { set: setMode, get: storedMode };
})();
