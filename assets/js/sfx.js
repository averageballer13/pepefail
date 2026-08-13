/* ===================================================================
   pepe.fail — sound effects

   Every sound is synthesised through WebAudio: nothing to download,
   nothing to cache, latency near zero. The module is fully standalone —
   it watches the DOM instead of asking the games to call it, so no game
   file knows this exists.

   Wiring:
   - pointerdown on interactive elements   -> tick
   - [data-result] / .bj-msg turning win   -> win chord
   -                        turning lose   -> low thud
   - balance chip going up                 -> coin
   - a card or tile appearing              -> pop

   Muted state persists in localStorage; the topbar button toggles it.
   =================================================================== */

(function () {
  "use strict";

  var MUTE_KEY = "pepe.muted";
  var ctx = null;
  var muted = false;
  var lastTick = 0;

  try { muted = window.localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}

  /* The context can only start after a user gesture; the first
     pointerdown both unlocks it and plays the first tick. */
  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /* One enveloped oscillator note. */
  function note(freq, type, t0, dur, peak, glideTo) {
    var a = ac();
    if (!a) return;
    var osc = a.createOscillator();
    var g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /* A short band-passed noise burst — the sound of something landing. */
  function pop(peak, freq) {
    var a = ac();
    if (!a) return;
    var len = Math.floor(a.sampleRate * 0.04);
    var buf = a.createBuffer(1, len, a.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = a.createBufferSource();
    src.buffer = buf;
    var f = a.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq || 900;
    f.Q.value = 1.4;
    var g = a.createGain();
    g.gain.value = peak;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  }

  var FX = {
    tick: function () {
      var a = ac(); if (!a) return;
      note(2100, "triangle", a.currentTime, 0.03, 0.045);
    },
    win: function () {
      var a = ac(); if (!a) return;
      var t = a.currentTime;
      note(659, "sine", t, 0.12, 0.11);          /* E5 */
      note(880, "sine", t + 0.09, 0.16, 0.11);   /* A5 */
      note(1318, "sine", t + 0.18, 0.2, 0.07);   /* E6, quieter tail */
    },
    lose: function () {
      var a = ac(); if (!a) return;
      note(150, "sine", a.currentTime, 0.16, 0.14, 58);
    },
    coin: function () {
      var a = ac(); if (!a) return;
      var t = a.currentTime;
      note(1245, "square", t, 0.05, 0.03);
      note(1865, "sine", t + 0.04, 0.1, 0.06);
    },
    pop: function () { pop(0.12, 950); },
    deal: function () { pop(0.09, 1600); },
  };

  function play(kind) {
    if (muted) return;
    var fn = FX[kind];
    if (!fn) return;
    try { fn(); } catch (e) { /* audio is never worth an error */ }
  }

  /* =========================== WIRING =========================== */

  /* Clicks: one soft tick per press on anything interactive. */
  document.addEventListener(
    "pointerdown",
    function (e) {
      var el = e.target.closest && e.target.closest(
        "button, a, .nav__item, .game, .tile, .seg__tab, .slider, input[type=text]"
      );
      if (!el) return;
      var now = Date.now();
      if (now - lastTick < 40) return;
      lastTick = now;
      play("tick");
    },
    true
  );

  /* Round results: the settle path always stamps is-win / is-lose on
     the result line, and blackjack does the same on its message. */
  var lastResult = 0;
  var mo = new MutationObserver(function (records) {
    var now = Date.now();
    for (var i = 0; i < records.length; i++) {
      var r = records[i];

      if (r.type === "attributes") {
        var cl = r.target.classList;
        if (now - lastResult < 250) continue;
        if (cl.contains("is-win")) { lastResult = now; play("win"); }
        else if (cl.contains("is-lose")) { lastResult = now; play("lose"); }
        continue;
      }

      /* new cards and revealed tiles land with a pop */
      for (var j = 0; j < r.addedNodes.length; j++) {
        var n = r.addedNodes[j];
        if (!n.classList) continue;
        if (n.classList.contains("bj-card")) play("deal");
      }
    }
  });

  function arm() {
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  /* Mines tiles reveal on click; the class lands on the tile itself. */
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest(".tile");
    if (t) window.setTimeout(function () {
      if (t.classList.contains("gem")) play("pop");
      /* a mine already plays the lose thud via the result line */
    }, 30);
  });

  /* Balance going up rings the coin — skip the very first paint. */
  var lastBal = null;
  document.addEventListener("pepe:balance", function (e) {
    var v = e.detail && e.detail.balance;
    if (typeof v !== "number") return;
    /* Signing out swaps the bank mirror for the demo bank, which looks
       like a jump to 1,000 — re-baseline silently, no coin on logout. */
    var R = window.PepeReal;
    if (R && R.enabled && R.enabled() && !R.on()) { lastBal = v; return; }
    if (lastBal !== null && v > lastBal + 0.001) play("coin");
    lastBal = v;
  });

  /* =========================== MUTE =========================== */
  function setMuted(v) {
    muted = !!v;
    try { window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
    document.dispatchEvent(new CustomEvent("pepe:muted", { detail: { muted: muted } }));
  }

  window.PepeSfx = {
    play: play,
    muted: function () { return muted; },
    toggle: function () { setMuted(!muted); return muted; },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arm);
  } else {
    arm();
  }
})();
