/* ===================================================================
   pepe.fail — real mode bridge

   window.PepeReal talks to the serverless backend (api/) and mirrors
   the server balance into PepeEngine.Bank. When /api/config reports
   enabled:false — or the fetch fails — nothing here activates and the
   site keeps running in demo mode exactly as before.

   Load order: engine.js, modal.js, wallet.js, then this file, then
   wallet-panel.js / game-page.js.
   =================================================================== */

(function () {
  "use strict";

  var TOKEN_KEY = "pepe.token";

  var cfg = null;              /* /api/config payload once fetched */
  var token = null;            /* bearer token for the API */
  var addr = null;             /* address the token belongs to */
  var balances = { sol: 0, fail: 0 };  /* integers, base units */
  var activeAsset = "sol";
  var refreshBank = null;      /* emit fn returned by Bank.attachRemote */
  var attached = false;
  var signInFlight = null;     /* dedupe concurrent signIn calls */
  var initPromise = null;

  var DEFAULT_DECIMALS = { sol: 9, fail: 6 };

  function E() { return window.PepeEngine; }

  function err(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  function rid() {
    var a = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); });
    var s = "";
    for (var i = 0; i < a.length; i++) s += (a[i] + 256).toString(16).slice(1);
    return s;
  }

  function decimalsOf(asset) {
    if (cfg && Array.isArray(cfg.assets)) {
      for (var i = 0; i < cfg.assets.length; i++) {
        if (cfg.assets[i].k === asset && isFinite(cfg.assets[i].decimals)) return cfg.assets[i].decimals;
      }
    }
    return DEFAULT_DECIMALS[asset] || 9;
  }

  function toUnits(asset, amountFloat) {
    return Math.round(amountFloat * Math.pow(10, decimalsOf(asset)));
  }

  function toFloat(asset, units) {
    return (units || 0) / Math.pow(10, decimalsOf(asset));
  }

  /* --- token -------------------------------------------------------- */

  function parseToken(t) {
    try {
      var b64 = t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var payload = JSON.parse(atob(b64));
      /* refuse tokens that expire within the next minute */
      if (!payload || !payload.a || !(payload.e > Date.now() + 60000)) return null;
      return payload;
    } catch (e) {
      return null;
    }
  }

  function readStoredToken() {
    try {
      var t = localStorage.getItem(TOKEN_KEY);
      if (!t) return null;
      var p = parseToken(t);
      return p ? { token: t, addr: p.a } : null;
    } catch (e) {
      return null;
    }
  }

  function walletAddress() {
    var w = window.PepeWallet && window.PepeWallet.get && window.PepeWallet.get();
    return w ? w.address : null;
  }

  /* --- mirror ------------------------------------------------------- */

  function attach() {
    if (attached || !E()) return;
    attached = true;
    refreshBank = E().Bank.attachRemote({
      get: function () { return toFloat(activeAsset, balances[activeAsset]); },
    });
  }

  function detach() {
    if (!attached) return;
    attached = false;
    refreshBank = null;
    if (E()) E().Bank.attachRemote(null);
  }

  function syncBalance(res, asset) {
    if (res && typeof res.balance === "number" && isFinite(res.balance)) {
      balances[asset || res.asset || activeAsset] = res.balance;
      if (refreshBank) refreshBank();
    }
  }

  /* --- HTTP --------------------------------------------------------- */

  /* body === undefined -> GET, otherwise POST JSON. Throws Error with a
     .code on any failure. A 401 clears the token, re-runs the sign-in
     flow once and retries, so an expired session heals in place. */
  function api(path, body, opts) {
    opts = opts || {};
    var headers = {};
    var init = { method: body === undefined ? "GET" : "POST", headers: headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    if (!opts.noAuth && token) headers["authorization"] = "Bearer " + token;

    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (res.status === 401 && !opts.noAuth && !opts.retried && !opts.noRetry) {
          signOut(true);
          return signIn().then(
            function () {
              return api(path, body, { retried: true });
            },
            function (e) {
              /* Re-auth declined or failed: cut fully, so the topbar and
                 the bank mirror stop claiming a session that is gone. */
              signOut(false);
              throw e;
            }
          );
        }
        if (!res.ok) {
          var code = (json && (json.error || json.code)) || "http_" + res.status;
          var msg = (json && (json.message || json.msg)) || "Request failed (" + res.status + ")";
          throw err(code, msg);
        }
        if (json && json.ok === true && json.data !== undefined) return json.data;
        return json || {};
      });
    });
  }

  /* --- public RPC (deposits need a blockhash + broadcast) ----------- */

  function rpcUrl() {
    if (cfg && cfg.rpcUrl) return cfg.rpcUrl;
    return cfg && cfg.network === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com";
  }

  function rpc(method, params) {
    return fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params || [] }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) throw err("rpc", j.error.message || "RPC error");
        return j.result;
      });
  }

  /* --- lifecycle ---------------------------------------------------- */

  function init() {
    if (initPromise) return initPromise;
    initPromise = fetch("/api/config")
      .then(function (r) { return r.json(); })
      .then(function (json) {
        cfg = json && json.ok === true && json.data !== undefined ? json.data : json;
        if (!cfg || !cfg.enabled) { cfg = cfg || { enabled: false }; }
        /* Remembered so the next page load renders the right topbar
           before this fetch resolves — no demo-balance flash. */
        try { localStorage.setItem("pepe.realmode", cfg.enabled ? "1" : "0"); } catch (e) { /* ignore */ }
        if (!cfg.enabled) return cfg;

        /* Resume a previous session when the stored token matches the
           wallet currently in this browser. */
        var stored = readStoredToken();
        var wa = walletAddress();
        if (stored && wa && stored.addr === wa) {
          token = stored.token;
          addr = stored.addr;
          attach();
          /* noRetry: a 401 here must NOT re-enter signIn(), which waits
             on this very init() — that would deadlock the page. */
          return refreshBalance({ noRetry: true }).then(
            function () { announce(); return cfg; },
            function (e) {
              if (/401|unauthorized|token/i.test(String(e && e.code))) {
                /* Server rejected the stored token — cut to signed-out. */
                signOut(false);
              } else {
                /* Transient failure: keep the session, balance comes on
                   the next action. */
                announce();
              }
              return cfg;
            }
          );
        }
        /* No session to resume — still announce, so the topbar knows
           real mode is live and renders its signed-out state. */
        announce();
        return cfg;
      })
      .catch(function () {
        /* No backend deployed: pure demo mode. */
        cfg = { enabled: false };
        return cfg;
      });
    return initPromise;
  }

  function announce() {
    document.dispatchEvent(new CustomEvent("pepe:real", {
      detail: { on: on(), address: addr, asset: activeAsset },
    }));
  }

  function signIn() {
    if (signInFlight) return signInFlight;
    signInFlight = doSignIn().then(
      function (v) { signInFlight = null; return v; },
      function (e) { signInFlight = null; throw e; }
    );
    return signInFlight;
  }

  function doSignIn() {
    return init().then(function () {
      if (!cfg.enabled) throw err("disabled", "Real mode is not configured on this deployment.");
      var address = walletAddress();
      if (!address) {
        if (window.PepeWallet) window.PepeWallet.startCreateFlow();
        throw err("no-wallet", "Create a wallet first.");
      }
      return api("/api/auth/challenge", { address: address }, { noAuth: true })
        .then(function (ch) {
          return window.PepeWallet.signMessage(ch.message).then(function (signature) {
            return api("/api/auth/verify", { address: address, nonce: ch.nonce, signature: signature }, { noAuth: true });
          });
        })
        .then(function (v) {
          token = v.token;
          addr = address;
          try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ }
          attach();
          return refreshBalance().catch(function () {});
        })
        .then(function () { announce(); return true; });
    });
  }

  function signOut(keepMirror) {
    token = null;
    addr = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    /* keepMirror: a 401 retry is about to sign back in, so tearing the
       mirror down would make the balance chip flash the demo number. */
    if (!keepMirror) {
      detach();
      announce();
    }
  }

  function on() {
    return !!(cfg && cfg.enabled && token && addr);
  }

  function enabled() {
    return !!(cfg && cfg.enabled);
  }

  function refreshBalance(opts) {
    return api("/api/wallet/balance", undefined, opts).then(function (b) {
      if (b && typeof b.sol === "number") balances.sol = b.sol;
      if (b && typeof b.fail === "number") balances.fail = b.fail;
      if (refreshBank) refreshBank();
      return b;
    });
  }

  /* --- betting ------------------------------------------------------ */

  /* One-shot games resolve with {settled:true, outcome, payout, ...};
     multi-step games resolve with {roundId, state}. payoutFloat is
     added for the UI either way. */
  function place(game, params, amountFloat) {
    var amount = toUnits(activeAsset, amountFloat);
    return api("/api/bet/place", {
      game: game,
      asset: activeAsset,
      amount: amount,
      params: params || {},
      clientRoundId: rid(),
    }).then(decorate);
  }

  function act(roundId, action, payload) {
    return api("/api/bet/act", {
      roundId: roundId,
      action: action,
      payload: payload || {},
    }).then(decorate);
  }

  function roundState(roundId) {
    return api("/api/bet/state?roundId=" + encodeURIComponent(roundId)).then(decorate);
  }

  function decorate(r) {
    syncBalance(r);
    if (r) r.payoutFloat = toFloat(activeAsset, r.payout);
    return r;
  }

  /* --- wallet moves ------------------------------------------------- */

  /* The tx takes a few seconds to confirm on-chain, so a "not found"
     answer is retried 5 times, 3 s apart, before giving up. */
  function deposit(signature) {
    var attempt = function (left) {
      return api("/api/wallet/deposit", { signature: signature }).then(
        function (r) {
          syncBalance(r);
          return r;
        },
        function (e) {
          var code = String(e.code || "").toLowerCase();
          var retriable = code.indexOf("not-found") !== -1 || code.indexOf("not_found") !== -1 || code.indexOf("pending") !== -1;
          if (!retriable || left <= 0) throw e;
          return new Promise(function (res) { setTimeout(res, 3000); }).then(function () {
            return attempt(left - 1);
          });
        }
      );
    };
    return attempt(5);
  }

  function withdraw(asset, amountFloat) {
    asset = asset || activeAsset;
    return api("/api/wallet/withdraw", {
      asset: asset,
      amount: toUnits(asset, amountFloat),
      requestId: rid(),
    }).then(function (r) {
      syncBalance(r, asset);
      return r; /* { signature, balance } */
    });
  }

  /* --- live deposits ------------------------------------------------
     Each player has a house-derived deposit address; funds sent there
     from anywhere are swept and credited automatically. The watcher
     polls while the player is signed in and the tab is visible, so an
     arriving deposit surfaces within seconds without any click. */

  var depositAddr = null;
  var sweepInFlight = false;
  var watchTimer = null;
  var watchFastUntil = 0;

  /* On-chain lamports sitting in the browser wallet itself — shown so
     the player can move them into the casino in one click. */
  function chainBalance() {
    var a = walletAddress();
    if (!a) return Promise.resolve(0);
    return rpc("getBalance", [a]).then(function (r) {
      return r && typeof r.value === "number" ? r.value : 0;
    });
  }

  function depositAddress() {
    if (depositAddr) return Promise.resolve(depositAddr);
    return api("/api/wallet/deposit-address").then(function (r) {
      depositAddr = r && r.address;
      return depositAddr;
    });
  }

  function sweepOnce() {
    if (!on() || sweepInFlight) return Promise.resolve(null);
    sweepInFlight = true;
    return api("/api/wallet/sweep", {}).then(
      function (r) {
        sweepInFlight = false;
        if (r && r.credited > 0) {
          syncBalance(r);
          document.dispatchEvent(new CustomEvent("pepe:deposit", {
            detail: {
              amountFloat: toFloat("sol", r.credited),
              signature: r.signature || null,
            },
          }));
        }
        return r;
      },
      function () { sweepInFlight = false; return null; }
    );
  }

  /* 8s at rest, 4s for two minutes after the deposit panel opens. */
  function watchDeposits(fast) {
    if (fast) watchFastUntil = Date.now() + 120000;
    if (watchTimer) return;
    var tick = function () {
      var period = Date.now() < watchFastUntil ? 4000 : 8000;
      watchTimer = setTimeout(function () {
        if (on() && document.visibilityState === "visible") {
          sweepOnce().then(tick, tick);
        } else {
          tick();
        }
      }, period);
    };
    tick();
  }

  document.addEventListener("pepe:real", function () {
    if (on()) watchDeposits(false);
  });

  /* --- misc --------------------------------------------------------- */

  function explorerTx(signature) {
    var cluster = cfg && cfg.network === "mainnet-beta" ? "" : "?cluster=devnet";
    return "https://solscan.io/tx/" + signature + cluster;
  }

  function setAsset(asset) {
    if (asset !== "sol" && asset !== "fail") return;
    activeAsset = asset;
    if (refreshBank) refreshBank();
    announce();
  }

  window.PepeReal = {
    init: init,
    signIn: signIn,
    signOut: function () { signOut(false); },
    on: on,
    enabled: enabled,
    config: function () { return cfg; },
    address: function () { return addr; },
    asset: function () { return activeAsset; },
    setAsset: setAsset,
    balance: function (asset) { return toFloat(asset || activeAsset, balances[asset || activeAsset]); },
    balanceUnits: function (asset) { return balances[asset || activeAsset] || 0; },
    refreshBalance: refreshBalance,
    api: api,
    rpc: rpc,
    place: place,
    act: act,
    state: roundState,
    deposit: deposit,
    chainBalance: chainBalance,
    depositAddress: depositAddress,
    sweepOnce: sweepOnce,
    watchDeposits: watchDeposits,
    withdraw: withdraw,
    explorerTx: explorerTx,
    toUnits: toUnits,
    toFloat: toFloat,
  };

  /* Fire and forget: pages check PepeReal.on() at interaction time,
     long after this settles. */
  init();
})();
