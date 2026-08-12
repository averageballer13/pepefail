/* ===================================================================
   pepe.fail — motion layer (companion of assets/css/anim.css)

   One job: reveal blocks once, discreetly, when they enter the
   scrolling container. Nothing else animates on its own.

   Public API
     window.PepeAnim.init()   scan the DOM and arm the new elements.
                              Idempotent: an element is only ever
                              prepared once. Call it again after any
                              dynamic injection (shell, card rows,
                              content mounted inside .main).

   Notes
     - On shell pages the scrolling element is .main (overflow-y:auto),
       not the document, so it is used as the observer root.
     - Elements are only hidden by JS (class .is-revealing). If this
       file fails to load, every block stays visible.
     - Elements outside the scroll root are left untouched: they would
       never intersect it and would stay invisible forever.
   =================================================================== */

(function () {
  "use strict";

  /* Blocks revealed automatically, plus anything an author tagged
     with data-reveal directly in the HTML. */
  var TARGETS = "[data-reveal], .section, .game, .pcard";

  /* Containers whose direct children are staggered. */
  var STAGGER_PARENTS = ".game-row, .game-grid, .promo-grid";

  /* Horizontal scrollers. Their overflow clips the cards sitting past
     the right edge, so those cards would never intersect the root on
     their own. The row is watched instead and reveals its cards in one
     go, which also reads better: a row arrives as a row. */
  var ROW_PROXY = ".game-row";

  var STAGGER_STEP = 35;   /* ms between two siblings */
  var STAGGER_CAP = 8;     /* past this index, no delay at all */
  var REVEAL_MS = 220;     /* keep in sync with --dur-reveal */
  var CLEANUP_PAD = 120;   /* margin before dropping the state classes */

  var canObserve = typeof window.IntersectionObserver === "function";
  var reduced =
    !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  var prepared = new WeakSet();  /* elements already handled */
  var pending = new Set();       /* observed targets, not revealed yet */
  var groups = new Map();        /* row proxy -> cards it reveals */

  var observer = null;
  var observerRoot;              /* undefined until the first build */
  var domObserver = null;
  var scanQueued = false;

  /* --- The element that actually scrolls (null = viewport) --- */
  function scrollRoot() {
    return document.querySelector(".main") || null;
  }

  function scrollTopOf(rootEl) {
    if (rootEl) return rootEl.scrollTop;
    return window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  function rootTopOf(rootEl) {
    return rootEl ? rootEl.getBoundingClientRect().top : 0;
  }

  function rootHeightOf(rootEl) {
    return rootEl ? rootEl.clientHeight : window.innerHeight;
  }

  /* =========================== OBSERVER =========================== */

  /* An entry is due when it enters the root, but also when it already
     sits above it: a page reloaded with its scroll position restored
     observes such blocks as "past" from the very first callback. */
  function isDue(entry) {
    if (entry.isIntersecting) return true;
    var bounds = entry.rootBounds;
    return !!bounds && entry.boundingClientRect.bottom <= bounds.top;
  }

  function onIntersect(entries, obs) {
    for (var i = 0; i < entries.length; i++) {
      if (!isDue(entries[i])) continue;
      release(entries[i].target, obs);
    }
  }

  /* Reveal a watched target: the row group it stands for, itself, or
     both, then stop watching it. */
  function release(target, obs) {
    obs.unobserve(target);
    pending.delete(target);

    var group = groups.get(target);
    if (group) {
      groups.delete(target);
      group.forEach(reveal);
    }
    if (target.hasAttribute("data-reveal")) reveal(target);
  }

  function ensureObserver() {
    var rootEl = scrollRoot();
    if (observer && observerRoot === rootEl) return observer;

    if (observer) observer.disconnect();
    stopJumpWatch();

    observerRoot = rootEl;
    observer = new IntersectionObserver(onIntersect, {
      root: rootEl,
      rootMargin: "0px 0px -8% 0px",
      /* 0.1 is the trigger; 0 keeps blocks taller than the viewport
         working, since their ratio can never reach 0.1. */
      threshold: [0, 0.1]
    });
    pending.forEach(function (el) { observer.observe(el); });
    return observer;
  }

  /* =========================== JUMP SAFETY NET ===========================
     A scroll that teleports (anchor link, End key, scrollTop set by
     script) can carry a block from below the root to above it without a
     single intersecting frame: no threshold is crossed, so the observer
     stays silent and the block would never show up. The listener below
     only reads scrollTop once per frame and does real work on an actual
     jump; it detaches as soon as nothing is left to reveal. */

  var jumpScroller = null;
  var jumpHandler = null;
  var lastScrollTop = 0;
  var sweepQueued = false;

  function startJumpWatch() {
    if (jumpHandler || !pending.size) return;

    var rootEl = observerRoot || null;
    jumpScroller = rootEl || window;
    lastScrollTop = scrollTopOf(rootEl);

    jumpHandler = function () {
      if (sweepQueued) return;
      sweepQueued = true;
      window.requestAnimationFrame(function () {
        sweepQueued = false;
        var top = scrollTopOf(rootEl);
        var jumped = Math.abs(top - lastScrollTop) > rootHeightOf(rootEl);
        lastScrollTop = top;
        if (jumped) sweepPassed(rootEl);
        if (!pending.size) stopJumpWatch();
      });
    };

    jumpScroller.addEventListener("scroll", jumpHandler, { passive: true });
  }

  function stopJumpWatch() {
    if (!jumpHandler) return;
    jumpScroller.removeEventListener("scroll", jumpHandler);
    jumpHandler = null;
    jumpScroller = null;
  }

  /* Reveal every watched target now sitting above the root. */
  function sweepPassed(rootEl) {
    if (!pending.size) return;
    var limit = rootTopOf(rootEl);
    var passed = [];
    pending.forEach(function (target) {
      if (target.getBoundingClientRect().bottom <= limit) passed.push(target);
    });
    for (var i = 0; i < passed.length; i++) release(passed[i], observer);
  }

  /* =========================== REVEAL =========================== */

  /* Play the fade, then drop every trace of it. */
  function reveal(el) {
    if (!el.classList.contains("is-revealing")) return;
    el.classList.add("is-revealed");

    var delay = parseInt(el.style.getPropertyValue("--reveal-delay"), 10) || 0;
    window.setTimeout(function () {
      el.classList.remove("is-revealing");
      el.classList.remove("is-revealed");
      el.style.removeProperty("--reveal-delay");
    }, REVEAL_MS + delay + CLEANUP_PAD);
  }

  /* Arm one element. */
  function prepare(el, delay) {
    prepared.add(el);
    el.setAttribute("data-reveal", "");

    /* No motion wanted, or no observer available: the element simply
       stays as it is, fully visible. */
    if (reduced || !canObserve) return;

    if (delay > 0) el.style.setProperty("--reveal-delay", delay + "ms");
    el.classList.add("is-revealing");

    /* Inside a horizontal scroller the row is the watched target. */
    var parent = el.parentElement;
    if (parent && parent.matches && parent.matches(ROW_PROXY)) {
      var group = groups.get(parent);
      if (group) {
        group.push(el);          /* the row is already watched */
        return;
      }
      groups.set(parent, [el]);
      watch(parent);
      return;
    }

    watch(el);
  }

  function watch(target) {
    pending.add(target);
    ensureObserver().observe(target);
    startJumpWatch();
  }

  /* =========================== SCAN =========================== */

  function scan() {
    var scope = scrollRoot() || document;
    var els = scope.querySelectorAll(TARGETS);
    if (!els.length) return;

    var counters = new Map();

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (prepared.has(el)) continue;

      var delay = 0;
      var parent = el.parentElement;
      if (parent && parent.matches && parent.matches(STAGGER_PARENTS)) {
        var index = counters.get(parent) || 0;
        counters.set(parent, index + 1);
        delay = index < STAGGER_CAP ? index * STAGGER_STEP : 0;
      }

      prepare(el, delay);
    }
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    window.requestAnimationFrame(function () {
      scanQueued = false;
      scan();
    });
  }

  /* Catch rows injected after load (games-data.js, page scripts). */
  function watchDom() {
    if (domObserver || typeof window.MutationObserver !== "function") return;
    var scope = scrollRoot() || document.body;
    if (!scope) return;

    domObserver = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].addedNodes.length) {
          queueScan();
          return;
        }
      }
    });

    /* childList only: the classes and attributes set above never feed
       back into this observer. */
    domObserver.observe(scope, { childList: true, subtree: true });
  }

  function init() {
    scan();
    watchDom();
  }

  window.PepeAnim = { init: init };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
