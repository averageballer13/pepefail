/* ===================================================================
   pepe.fail — game engine core

   Shared by every game: the balance, the random source, formatting and
   the payout maths.

   Money is play money for now. Nothing here touches a wallet or the
   chain; when real deposits land, only Bank needs to change.
   =================================================================== */

(function () {
  "use strict";

  /* --- House edge -------------------------------------------------
     1% edge = the 99% RTP printed on every game page. Every payout in
     the site is derived from this one number, so changing it here
     changes the whole casino consistently. Set it to 0 for a true
     coin-flip with no edge at all. */
  var HOUSE_EDGE = 0.01;
  var RTP = 1 - HOUSE_EDGE;

  /* =========================== RANDOM ===========================
     crypto.getRandomValues, not Math.random: the results decide money,
     so the source has to be unpredictable rather than merely varied. */
  function rnd() {
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint32Array(2);
      window.crypto.getRandomValues(a);
      /* 53 bits of entropy, evenly spread over [0,1) */
      return (a[0] * 2097152 + (a[1] >>> 11)) / 9007199254740992;
    }
    return Math.random();
  }

  function rndInt(min, max) {
    return min + Math.floor(rnd() * (max - min + 1));
  }

  /* Fisher-Yates, unbiased. */
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* =========================== BALANCE =========================== */
  var KEY = "pepe.balance";
  var START = 1000;
  var listeners = [];
  var balance = load();

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw === null) return START;
      var v = parseFloat(raw);
      return isFinite(v) && v >= 0 ? v : START;
    } catch (e) {
      return START;
    }
  }

  function save() {
    try { window.localStorage.setItem(KEY, String(balance)); } catch (e) {}
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) listeners[i](balance);
    document.dispatchEvent(new CustomEvent("pepe:balance", { detail: { balance: balance } }));
  }

  var Bank = {
    get: function () { return balance; },
    set: function (v) {
      balance = Math.max(0, round2(v));
      save(); emit();
      return balance;
    },
    add: function (v) { return Bank.set(balance + v); },
    sub: function (v) { return Bank.set(balance - v); },
    canBet: function (v) { return v > 0 && v <= balance + 1e-9; },
    reset: function () { return Bank.set(START); },
    onChange: function (fn) { listeners.push(fn); fn(balance); },
  };

  /* =========================== HELPERS =========================== */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function fmt(n) {
    return round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtMult(n) {
    if (n >= 1000) return Math.round(n).toLocaleString("en-US") + "×";
    return (Math.round(n * 100) / 100).toFixed(2) + "×";
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* Fair payout for a given win probability, edge included. */
  function payoutFor(chance) {
    if (chance <= 0) return 0;
    return RTP / chance;
  }

  /* =========================== RANKS ===========================
     Progress is earned on fees paid to the house, not on wins. Wagering
     is what actually costs you, so it is what the ladder measures — and
     it cannot be farmed by a lucky streak. */
  var XP_KEY = "pepe.xp";

  /* at       = fees paid to reach the rank
     rakeback = share of your own fees returned
     ref      = share of an invite's fees you earn */
  var RANKS = [
    { k: "tadpole", n: "Tadpole",     ic: "chip",    at: 0,     rakeback: 5,  ref: 25 },
    { k: "frog", n: "Frog",           ic: "frog",    at: 10,    rakeback: 10, ref: 28 },
    { k: "golden", n: "Golden Frog",  ic: "star",    at: 100,   rakeback: 15, ref: 32 },
    { k: "king", n: "King Pepe",      ic: "crown",   at: 1000,  rakeback: 20, ref: 36 },
    { k: "legend", n: "Legend",       ic: "diamond", at: 10000, rakeback: 25, ref: 40 },
  ];

  /* Everyone starts with a sliver on the bar. A rank meter sitting at a
     flat zero reads as broken rather than as new. */
  var START_XP = 1;

  var xp = readXp();

  function readXp() {
    try {
      var v = parseFloat(window.localStorage.getItem(XP_KEY));
      return isFinite(v) && v > START_XP ? v : START_XP;
    } catch (e) {
      return START_XP;
    }
  }

  function saveXp() {
    try { window.localStorage.setItem(XP_KEY, String(xp)); } catch (e) {}
  }

  var Rank = {
    xp: function () { return xp; },
    ranks: RANKS,

    /* A wager of `amount` hands the house `amount * edge` on average.
       That is the fee, and that is the XP. */
    wager: function (amount) {
      if (!(amount > 0)) return;
      var before = Rank.current().k;
      xp = round2(xp + amount * HOUSE_EDGE);
      saveXp();
      var after = Rank.current().k;
      document.dispatchEvent(
        new CustomEvent("pepe:rank", { detail: { xp: xp, promoted: before !== after } })
      );
    },

    current: function () {
      var r = RANKS[0];
      for (var i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].at) r = RANKS[i];
      return r;
    },

    next: function () {
      for (var i = 0; i < RANKS.length; i++) if (xp < RANKS[i].at) return RANKS[i];
      return null;
    },

    /* 0..1 through the current band; a maxed rank reads as full. */
    progress: function () {
      var cur = Rank.current();
      var nxt = Rank.next();
      if (!nxt) return 1;
      var span = nxt.at - cur.at;
      return span <= 0 ? 1 : clamp((xp - cur.at) / span, 0, 1);
    },

    reset: function () {
      xp = START_XP;
      saveXp();
      document.dispatchEvent(new CustomEvent("pepe:rank", { detail: { xp: xp } }));
    },
  };

  /* =========================== PLAY HISTORY ===========================
     Recently played starts empty and only fills once a bet is actually
     settled — it reflects what you did, it is not a shop window. */
  var RECENT_KEY = "pepe.recent";
  var FAV_KEY = "pepe.favorites";
  var RECENT_MAX = 12;

  function readList(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return [];
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function writeList(key, list) {
    try { window.localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
  }

  var History = {
    /* Called by a game the first time it settles a round. */
    played: function (key) {
      if (!key) return;
      var list = readList(RECENT_KEY).filter(function (e) { return e.k !== key; });
      list.unshift({ k: key, t: Date.now() });
      writeList(RECENT_KEY, list.slice(0, RECENT_MAX));
      document.dispatchEvent(new CustomEvent("pepe:recent"));
    },
    recent: function () { return readList(RECENT_KEY); },
    clearRecent: function () {
      writeList(RECENT_KEY, []);
      document.dispatchEvent(new CustomEvent("pepe:recent"));
    },

    favorites: function () { return readList(FAV_KEY); },
    isFavorite: function (key) { return readList(FAV_KEY).indexOf(key) !== -1; },
    toggleFavorite: function (key) {
      var list = readList(FAV_KEY);
      var i = list.indexOf(key);
      if (i === -1) list.push(key); else list.splice(i, 1);
      writeList(FAV_KEY, list);
      document.dispatchEvent(new CustomEvent("pepe:favorites"));
      return i === -1;
    },
  };

  window.PepeEngine = {
    History: History,
    Rank: Rank,
    HOUSE_EDGE: HOUSE_EDGE,
    RTP: RTP,
    rnd: rnd,
    rndInt: rndInt,
    shuffle: shuffle,
    round2: round2,
    fmt: fmt,
    fmtMult: fmtMult,
    clamp: clamp,
    payoutFor: payoutFor,
    Bank: Bank,
  };
})();
