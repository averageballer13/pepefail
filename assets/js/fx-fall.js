/* ===================================================================
   pepe.fail — falling gold props (background layer)

   Coins and cards drift from the top of the screen to the bottom while
   spinning on their own axis. Every piece gets its own size, speed,
   spin rate, drift and phase, so the field never reads as a loop.

   Drawn on a single canvas: one compositing layer instead of dozens of
   animated DOM nodes.

   Skipped entirely when the user asked for reduced motion, and paused
   while the tab is hidden.
   =================================================================== */

(function () {
  "use strict";

  var canvas = document.querySelector("[data-fall]");
  if (!canvas) return;

  var reduced =
    !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (reduced) return;

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  /* --- Tuning --------------------------------------------------- */
  var DENSITY = 1 / 38000;   /* pieces per css pixel of surface */
  var MIN_PIECES = 10;
  var MAX_PIECES = 32;
  var GOLD_HI = "#ffe86b";
  var GOLD = "#ffce1f";
  var GOLD_LO = "#c07f12";

  var dpr = 1;
  var w = 0;
  var h = 0;
  var pieces = [];
  var last = 0;
  var raf = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  /* --- One falling piece ---------------------------------------- */
  /* `y` is seeded across the whole column height so the first frame is
     already a full field rather than an empty screen filling up. */
  function makePiece(seeded) {
    var kind = Math.random() < 0.62 ? "coin" : "card";
    var size = kind === "coin" ? rand(14, 34) : rand(18, 40);

    return {
      kind: kind,
      size: size,
      /* smaller pieces read as further away: slower, fainter */
      x: rand(-40, w + 40),
      y: seeded ? rand(-h * 0.3, h) : rand(-h * 0.25, -30),
      vy: rand(14, 46) * (0.6 + size / 40),
      drift: rand(-13, 13),
      /* horizontal sway, so the fall is not a straight line */
      swayAmp: rand(6, 26),
      swayRate: rand(0.15, 0.5),
      swayPhase: rand(0, Math.PI * 2),
      /* spin on its own axis */
      spin: rand(0, Math.PI * 2),
      spinRate: rand(-1.5, 1.5),
      /* in-plane tilt for cards */
      tilt: rand(0, Math.PI * 2),
      tiltRate: rand(-0.5, 0.5),
      alpha: rand(0.05, 0.18) * (0.5 + size / 40),
      face: pick(["spade", "club", "heart", "diamond"])
    };
  }

  function build() {
    var target = Math.round(w * h * DENSITY);
    if (target < MIN_PIECES) target = MIN_PIECES;
    if (target > MAX_PIECES) target = MAX_PIECES;

    pieces = [];
    for (var i = 0; i < target; i++) pieces.push(makePiece(true));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  /* --- Shapes ---------------------------------------------------- */

  /* A coin seen edge-on: the spin squashes its width, and the rim
     catches the light when it turns away from the viewer. */
  function drawCoin(p) {
    var r = p.size / 2;
    var squash = Math.cos(p.spin);
    var rx = Math.abs(squash) * r;

    var grad = ctx.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, GOLD_HI);
    grad.addColorStop(0.45, GOLD);
    grad.addColorStop(1, GOLD_LO);

    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(rx, 0.6), r, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    /* inner ring, only while the face is open enough to show it */
    if (rx > r * 0.45) {
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 0.62, r * 0.62, 0, 0, Math.PI * 2);
      ctx.strokeStyle = GOLD_LO;
      ctx.lineWidth = Math.max(r * 0.09, 0.6);
      ctx.stroke();
    }
  }

  var SUIT = {
    spade: "M0 -5 C 3.4 -1.4 6 0.2 6 2.6 A 3 3 0 0 1 0.9 4.6 C 0.9 6.2 1.4 7.4 2.2 8 H -2.2 C -1.4 7.4 -0.9 6.2 -0.9 4.6 A 3 3 0 0 1 -6 2.6 C -6 0.2 -3.4 -1.4 0 -5 Z",
    heart: "M0 8 C -6 3.4 -6.6 0.6 -6.6 -1.4 A 3.4 3.4 0 0 1 0 -3 A 3.4 3.4 0 0 1 6.6 -1.4 C 6.6 0.6 6 3.4 0 8 Z",
    diamond: "M0 -8 L 5.4 0 L 0 8 L -5.4 0 Z",
    club: "M0 8 C 1 6.6 1.4 5.4 1.4 4.2 A 3 3 0 1 0 -2.4 0.4 A 3 3 0 1 0 2.4 0.4 A 3 3 0 1 0 -1.4 4.2 C -1.4 5.4 -1 6.6 0 8 Z"
  };
  var SUIT_PATH = {};
  if (typeof Path2D === "function") {
    for (var k in SUIT) SUIT_PATH[k] = new Path2D(SUIT[k]);
  }

  /* A playing card: rounded outline plus a small suit mark, squashed by
     the same spin so it flips like a real card. */
  function drawCard(p) {
    var hw = (p.size * 0.68) / 2;
    var hh = p.size / 2;
    var squash = Math.cos(p.spin);
    var sx = Math.abs(squash);
    if (sx < 0.02) sx = 0.02;

    ctx.scale(sx, 1);
    ctx.rotate(p.tilt);

    var r = Math.min(hw, hh) * 0.22;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(-hw, -hh, hw * 2, hh * 2, r);
    } else {
      ctx.rect(-hw, -hh, hw * 2, hh * 2);
    }
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(p.size * 0.045, 0.7);
    ctx.stroke();

    var mark = SUIT_PATH[p.face];
    if (mark) {
      var s = p.size / 26;
      ctx.save();
      ctx.scale(s, s);
      ctx.fillStyle = GOLD;
      ctx.fill(mark);
      ctx.restore();
    }
  }

  /* --- Loop ------------------------------------------------------ */
  function frame(now) {
    raf = window.requestAnimationFrame(frame);

    var dt = (now - last) / 1000;
    last = now;
    /* a tab that was throttled comes back with a huge delta */
    if (!(dt > 0) || dt > 0.1) dt = 0.016;

    ctx.clearRect(0, 0, w, h);

    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];

      p.y += p.vy * dt;
      p.x += p.drift * dt;
      p.spin += p.spinRate * dt;
      p.tilt += p.tiltRate * dt;
      p.swayPhase += p.swayRate * dt;

      /* recycle above the fold once fully past the bottom */
      if (p.y - p.size > h) {
        pieces[i] = makePiece(false);
        continue;
      }

      var x = p.x + Math.sin(p.swayPhase) * p.swayAmp;
      if (x < -60 || x > w + 60) continue;

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(x, p.y);
      if (p.kind === "coin") drawCoin(p);
      else drawCard(p);
      ctx.restore();
    }
  }

  function start() {
    if (raf) return;
    last = window.performance ? window.performance.now() : Date.now();
    raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    if (!raf) return;
    window.cancelAnimationFrame(raf);
    raf = 0;
  }

  /* --- Wiring ---------------------------------------------------- */
  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 180);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });

  resize();
  start();
})();
