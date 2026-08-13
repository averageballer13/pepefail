/* ===================================================================
   pepe.fail — wallet panel

   Deposit and withdraw, plus a plain statement of what the casino
   actually accepts: Solana only, SOL only for now, $FAIL once it is
   live. Nothing else is listed, because sending anything else would
   lose the funds.

   Two modes:
   - demo (backend not configured): the original informational screens.
   - real (PepeReal.enabled()): deposit signs a transfer from the
     browser wallet to the casino vault, withdraw asks the server to
     send SOL back to the wallet address.
   =================================================================== */

(function () {
  "use strict";

  const E = window.PepeEngine;

  /* --- What we accept. One chain, and we say so. --- */
  const CHAINS = [
    { k: "solana", n: "Solana", ic: "solana", on: true, note: "SPL · mainnet" },
  ];

  const ASSETS = [
    { k: "sol", n: "SOL", sub: "Solana", ic: "solana", on: true },
    { k: "fail", n: "$FAIL", sub: "pepe.fail token", ic: "coin", on: false, note: "Not launched" },
  ];

  const MIN_DEPOSIT = "0.01 SOL";

  function addr() {
    const w = window.PepeWallet;
    if (!w || typeof w.get !== "function") return null;
    let a = null;
    try { a = w.get(); } catch (e) { return null; }
    if (!a) return null;
    return typeof a === "string" ? a : a.address || a.publicKey || null;
  }

  function ico(name) {
    return typeof icon === "function" ? icon(name, 2) : "";
  }

  function real() { return window.PepeReal || null; }
  function realEnabled() { const r = real(); return !!(r && r.enabled()); }
  function realOn() { const r = real(); return !!(r && r.on()); }

  function fmtSol(v) {
    return (Math.round(v * 10000) / 10000).toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 4,
    });
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function shortAddr(a) {
    return a && a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-6) : a || "";
  }

  /* =========================== MARKUP =========================== */

  function chainRows() {
    return CHAINS.map(function (c) {
      const note = realEnabled() && real().config() && real().config().network === "devnet"
        ? "SPL · devnet" : c.note;
      return (
        '<div class="wp-row' + (c.on ? " is-on" : " is-off") + '">' +
          '<span class="wp-row__ico">' + ico(c.ic) + "</span>" +
          '<span class="wp-row__n">' + c.n + "<i>" + note + "</i></span>" +
          '<span class="wp-row__tag">' + (c.on ? "Supported" : "Unsupported") + "</span>" +
        "</div>"
      );
    }).join("");
  }

  function assetRows() {
    return ASSETS.map(function (a) {
      /* $FAIL flips on the moment the server announces its mint. */
      let on = a.on;
      if (a.k === "fail" && realEnabled()) {
        const cfg = real().config();
        on = !!(cfg && Array.isArray(cfg.assets) && cfg.assets.some(function (x) { return x.k === "fail"; }));
      }
      return (
        '<div class="wp-row' + (on ? " is-on" : " is-off") + '">' +
          '<span class="wp-row__ico">' + ico(a.ic) + "</span>" +
          '<span class="wp-row__n">' + a.n + "<i>" + a.sub + "</i></span>" +
          '<span class="wp-row__tag">' + (on ? "Accepted" : a.note) + "</span>" +
        "</div>"
      );
    }).join("");
  }

  function statusSlot() {
    return '<div class="wp-err" id="wpStatus" style="min-height:18px"></div>';
  }

  function signInBlock() {
    return (
      '<div class="wp-block">' +
        "<h4>Casino balance</h4>" +
        '<p class="wp-lead">Sign a one-time message with your wallet to open your casino balance. ' +
        "It costs nothing and moves nothing.</p>" +
        '<button class="btn btn--gold" id="wpSignIn">Sign in with wallet</button>' +
        '<div class="wp-err" id="wpSignErr"></div>' +
      "</div>"
    );
  }

  function balanceBlock() {
    const bal = realOn() ? real().balance("sol") : 0;
    return (
      '<div class="wp-block">' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          "<h4>Casino balance</h4>" +
          '<button type="button" class="pm-linkbtn" id="wpLogout" style="margin:0">Log out</button>' +
        "</div>" +
        '<div class="wp-bal"><span>' + ico("coin") + '</span><b id="wpRealBal">' + fmtSol(bal) + " SOL</b></div>" +
      "</div>"
    );
  }

  /* --- demo bodies (unchanged behaviour) --- */

  function depositBodyDemo() {
    const a = addr();

    if (!a) {
      return (
        '<div class="wp">' +
          '<p class="wp-lead">You need a wallet before you can deposit. It is generated in ' +
          "your browser and the key never leaves this device.</p>" +
          '<div class="wp-block"><h4>Network</h4>' + chainRows() + "</div>" +
          '<div class="wp-block"><h4>Accepted assets</h4>' + assetRows() + "</div>" +
        "</div>"
      );
    }

    return (
      '<div class="wp">' +
        '<div class="wp-block">' +
          "<h4>Deposit address</h4>" +
          '<div class="wp-addr"><code id="wpAddr">' + a + "</code>" +
          '<button class="btn btn--gold" id="wpCopy">Copy</button></div>' +
          '<p class="wp-warn">' + ico("shield") +
          "<span>Solana network only. Sending from another chain, or sending a token " +
          "that is not listed below, will lose the funds permanently.</span></p>" +
        "</div>" +
        '<div class="wp-block"><h4>Network</h4>' + chainRows() + "</div>" +
        '<div class="wp-block"><h4>Accepted assets</h4>' + assetRows() + "</div>" +
        '<div class="wp-note">Minimum deposit ' + MIN_DEPOSIT + ".</div>" +
      "</div>"
    );
  }

  function withdrawBodyDemo() {
    const a = addr();
    const bal = E ? E.fmt(E.Bank.get()) : "0.00";

    if (!a) {
      return '<div class="wp"><p class="wp-lead">Create a wallet first.</p></div>';
    }

    return (
      '<div class="wp">' +
        '<div class="wp-block">' +
          "<h4>Available</h4>" +
          '<div class="wp-bal"><span>' + ico("coin") + "</span><b>" + bal + "</b></div>" +
        "</div>" +
        '<div class="wp-block">' +
          "<h4>Destination address</h4>" +
          '<input class="wp-input" id="wpTo" type="text" spellcheck="false" ' +
          'placeholder="Solana address" autocomplete="off" />' +
          '<div class="wp-err" id="wpErr"></div>' +
        "</div>" +
        '<div class="wp-block">' +
          "<h4>Amount</h4>" +
          '<div class="wp-amt"><input class="wp-input" id="wpAmt" type="text" ' +
          'inputmode="decimal" placeholder="0.00" /><button class="btn btn--glass" id="wpMax">Max</button></div>' +
        "</div>" +
        '<div class="wp-block"><h4>Network</h4>' + chainRows() + "</div>" +
      "</div>"
    );
  }

  /* --- real bodies --- */

  function depositBodyReal() {
    const a = addr();

    if (!a) {
      return (
        '<div class="wp">' +
          '<p class="wp-lead">You need a wallet before you can deposit. It is generated in ' +
          "your browser and the key never leaves this device.</p>" +
          '<button class="btn btn--gold" id="wpCreate">Create wallet</button>' +
          '<div class="wp-block" style="margin-top:12px"><h4>Network</h4>' + chainRows() + "</div>" +
          '<div class="wp-block"><h4>Accepted assets</h4>' + assetRows() + "</div>" +
        "</div>"
      );
    }

    if (!realOn()) {
      return '<div class="wp">' + signInBlock() + "</div>";
    }

    return (
      '<div class="wp">' +
        balanceBlock() +
        '<div class="wp-block">' +
          "<h4>In your wallet</h4>" +
          '<div class="wp-bal"><span>' + ico("solana") + '</span><b id="wpChainBal">…</b></div>' +
          '<div class="wp-amt" style="margin-top:10px">' +
            '<input class="wp-input" id="wpDepAmt" type="text" inputmode="decimal" ' +
            'placeholder="0.00" autocomplete="off" />' +
            '<button class="btn btn--glass" id="wpDepMax">Max</button>' +
            '<button class="btn btn--gold" id="wpDepGo">Deposit</button>' +
          "</div>" +
          '<div class="wp-note">Moves SOL from your in-browser wallet to your casino ' +
          "balance. You confirm with your wallet password.</div>" +
        "</div>" +
        '<div class="wp-block">' +
          "<h4>Your deposit address</h4>" +
          '<div class="wp-addr"><code id="wpAddr">…</code>' +
          '<button class="btn btn--gold" id="wpCopy">Copy</button></div>' +
          '<div class="wp-note" style="margin-top:8px">Send SOL here from any wallet or ' +
          "exchange. It is credited automatically — no second step.</div>" +
          '<p class="wp-warn">' + ico("shield") +
          "<span>Solana network only. Sending from another chain will lose the funds " +
          "permanently.</span></p>" +
        "</div>" +
        '<div class="wp-block">' +
          '<div class="wp-watch" id="wpWatch">' +
            '<span class="wp-watch__dot"></span>' +
            "<span>Watching for your deposit…</span>" +
          "</div>" +
          statusSlot() +
        "</div>" +
        '<div class="wp-block"><h4>Network</h4>' + chainRows() + "</div>" +
        '<div class="wp-block"><h4>Accepted assets</h4>' + assetRows() + "</div>" +
        '<div class="wp-note">Minimum deposit ' + MIN_DEPOSIT + ".</div>" +
      "</div>"
    );
  }

  function withdrawBodyReal() {
    const a = addr();

    if (!a) {
      return '<div class="wp"><p class="wp-lead">Create a wallet first.</p></div>';
    }

    if (!realOn()) {
      return '<div class="wp">' + signInBlock() + "</div>";
    }

    const cfg = real().config() || {};
    const minW = cfg.minWithdraw ? real().toFloat("sol", cfg.minWithdraw) : 0.01;

    return (
      '<div class="wp">' +
        balanceBlock() +
        '<div class="wp-block">' +
          "<h4>Destination</h4>" +
          '<p class="wp-lead">Withdrawals are sent to your wallet: <code>' + esc(shortAddr(a)) + "</code></p>" +
        "</div>" +
        '<div class="wp-block">' +
          "<h4>Amount</h4>" +
          '<div class="wp-amt"><input class="wp-input" id="wpWdAmt" type="text" ' +
          'inputmode="decimal" placeholder="0.00" autocomplete="off" />' +
          '<button class="btn btn--glass" id="wpWdMax">Max</button>' +
          '<button class="btn btn--gold" id="wpWdGo">Withdraw</button></div>' +
          statusSlot() +
          '<div class="wp-note">Minimum withdrawal ' + fmtSol(minW) + " SOL.</div>" +
        "</div>" +
        '<div class="wp-block"><h4>Network</h4>' + chainRows() + "</div>" +
      "</div>"
    );
  }

  /* =========================== PANEL =========================== */

  function open(tab) {
    if (!window.PepeModal) return;
    const start = tab === "withdraw" ? "withdraw" : "deposit";

    const handle = window.PepeModal.open({
      title: "Wallet",
      subtitle: "Solana",
      size: "md",
      trust: true,
      body:
        '<div class="wp-tabs">' +
          '<button class="wp-tab" data-tab="deposit">' + ico("arrowDown") + "Deposit</button>" +
          '<button class="wp-tab" data-tab="withdraw">' + ico("arrowUp") + "Withdraw</button>" +
        "</div>" +
        '<div id="wpBody"></div>',
      actions: [
        { label: "Close", variant: "glass", onClick: function () { window.PepeModal.close(); } },
      ],
      onMount: function (h) { mount(h, start); },
    });

    return handle;
  }

  function mount(h, tab) {
    const root = h && h.panel ? h.panel : document;
    const body = root.querySelector("#wpBody");
    const tabs = Array.prototype.slice.call(root.querySelectorAll(".wp-tab"));
    let current = tab;

    function show(which) {
      current = which;
      tabs.forEach(function (t) { t.classList.toggle("is-on", t.dataset.tab === which); });
      if (realEnabled()) {
        body.innerHTML = which === "withdraw" ? withdrawBodyReal() : depositBodyReal();
        wireReal(root, which, show);
      } else {
        body.innerHTML = which === "withdraw" ? withdrawBodyDemo() : depositBodyDemo();
        wire(root, which);
      }
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () { show(t.dataset.tab); });
    });

    show(tab);

    /* If the config fetch is still in flight when the panel opens, the
       demo screens render first; repaint once the answer lands. */
    if (real() && !real().config()) {
      real().init().then(function () {
        if (document.contains(body)) show(current);
      });
    }
  }

  /* --- demo wiring (unchanged behaviour) --- */

  function wire(root, which) {
    if (which === "deposit") {
      wireCopy(root);
      return;
    }

    const to = root.querySelector("#wpTo");
    const amt = root.querySelector("#wpAmt");
    const max = root.querySelector("#wpMax");
    const err = root.querySelector("#wpErr");

    if (max && amt && E) {
      max.addEventListener("click", function () { amt.value = E.fmt(E.Bank.get()); });
    }

    /* Base58, 32-44 chars — the shape of a Solana address. Catching a
       typo here is cheaper than catching it on-chain. */
    if (to && err) {
      to.addEventListener("input", function () {
        const v = to.value.trim();
        if (!v) { err.textContent = ""; to.classList.remove("is-bad"); return; }
        const ok = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
        err.textContent = ok ? "" : "That does not look like a Solana address.";
        to.classList.toggle("is-bad", !ok);
      });
    }
  }

  function wireCopy(root) {
    const copy = root.querySelector("#wpCopy");
    const code = root.querySelector("#wpAddr");
    if (!copy || !code) return;
    copy.addEventListener("click", async function () {
      const text = code.textContent;
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; }
      catch (e) {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
        ta.remove();
      }
      const before = copy.textContent;
      copy.textContent = ok ? "Copied" : "Copy failed";
      window.setTimeout(function () { copy.textContent = before; }, 1400);
    });
  }

  /* --- real wiring --- */

  function wireReal(root, which, show) {
    const status = root.querySelector("#wpStatus");

    function setStatus(text, kind) {
      if (!status) return;
      status.textContent = text || "";
      status.style.color = kind === "ok" ? "#7ddc7d" : kind === "err" ? "" : "#9aa3c7";
    }

    function refreshBal() {
      const el = root.querySelector("#wpRealBal");
      if (el && realOn()) el.textContent = fmtSol(real().balance("sol")) + " SOL";
    }

    /* Sign-in screen (either tab) */
    const signBtn = root.querySelector("#wpSignIn");
    if (signBtn) {
      signBtn.addEventListener("click", function () {
        const errEl = root.querySelector("#wpSignErr");
        signBtn.disabled = true;
        real().signIn().then(
          function () { show(which); },
          function (e) {
            signBtn.disabled = false;
            if (errEl) errEl.textContent = (e && e.message) || "Sign-in failed.";
          }
        );
      });
      return;
    }

    const createBtn = root.querySelector("#wpCreate");
    if (createBtn) {
      createBtn.addEventListener("click", function () {
        if (window.PepeWallet) window.PepeWallet.startCreateFlow();
      });
      return;
    }

    /* Signed-in screens carry a Log out link next to the balance. It
       drops the session token; the wallet itself stays on the device. */
    const logoutBtn = root.querySelector("#wpLogout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        real().signOut();
        show(which);
      });
    }

    if (which === "deposit") {
      wireCopy(root);

      /* Fill in the house-derived deposit address, then let the global
         watcher do the work — sped up while this panel is open. */
      const addrEl = root.querySelector("#wpAddr");
      real().depositAddress().then(
        function (a) { if (addrEl && document.contains(addrEl)) addrEl.textContent = a; },
        function () { if (addrEl) addrEl.textContent = "unavailable — try again"; }
      );

      real().watchDeposits(true);
      real().sweepOnce();

      /* On-chain wallet balance + one-click move into the casino. */
      const chainEl = root.querySelector("#wpChainBal");
      let chainLamports = 0;
      const FEE = 5000; /* network fee the wallet pays on the transfer */

      function refreshChain() {
        real().chainBalance().then(function (l) {
          chainLamports = l;
          if (chainEl && document.contains(chainEl)) {
            chainEl.textContent = fmtSol(l / 1e9) + " SOL";
          }
        }, function () {
          if (chainEl && document.contains(chainEl)) chainEl.textContent = "—";
        });
      }
      refreshChain();

      const depAmt = root.querySelector("#wpDepAmt");
      const depMax = root.querySelector("#wpDepMax");
      const depGo = root.querySelector("#wpDepGo");

      if (depMax && depAmt) {
        depMax.addEventListener("click", function () {
          depAmt.value = String(Math.max(0, chainLamports - FEE) / 1e9);
        });
      }

      if (depGo && depAmt) {
        depGo.addEventListener("click", function () {
          const v = parseFloat(String(depAmt.value).replace(",", "."));
          if (!isFinite(v) || v <= 0) { setStatus("Enter an amount.", "err"); return; }
          const lam = Math.round(v * 1e9);
          if (lam + FEE > chainLamports) {
            setStatus("Not enough SOL in the wallet — the network fee needs " +
              fmtSol(FEE / 1e9) + " SOL on top.", "err");
            return;
          }
          depGo.disabled = true;
          setStatus("Confirm with your wallet password…");
          real().depositAddress()
            .then(function (to) {
              return window.PepeWallet.signAndSendTransfer({ to: to, lamports: lam });
            })
            .then(function () {
              depAmt.value = "";
              setStatus("Sent — crediting in a few seconds…", "ok");
              real().watchDeposits(true);
              refreshChain();
              window.setTimeout(refreshChain, 5000);
            })
            .catch(function (e) {
              setStatus((e && e.message) || "Transfer failed.", "err");
            })
            .then(function () { depGo.disabled = false; });
        });
      }

      const onDeposit = function (e) {
        const amount = e.detail && e.detail.amountFloat;
        if (!(amount > 0)) return;
        setStatus("Credited " + fmtSol(amount) + " SOL.", "ok");
        refreshBal();
        /* Public RPC reads at finalized commitment, which lags the sweep
           by a few seconds — refresh now and again once it caught up. */
        refreshChain();
        window.setTimeout(refreshChain, 5000);
      };
      document.addEventListener("pepe:deposit", onDeposit);
      document.addEventListener("pepe:balance", refreshBal);
      return;
    }

    /* withdraw */
    const amt = root.querySelector("#wpWdAmt");
    const max = root.querySelector("#wpWdMax");
    const go = root.querySelector("#wpWdGo");
    if (!amt || !go) return;

    if (max) {
      max.addEventListener("click", function () {
        amt.value = String(real().balance("sol"));
      });
    }

    go.addEventListener("click", async function () {
      const v = parseFloat(String(amt.value).replace(",", "."));
      if (!isFinite(v) || v <= 0) { setStatus("Enter an amount.", "err"); return; }

      const cfg = real().config() || {};
      const minW = cfg.minWithdraw ? real().toFloat("sol", cfg.minWithdraw) : 0;
      if (minW && v < minW) { setStatus("Minimum withdrawal is " + fmtSol(minW) + " SOL.", "err"); return; }
      if (v > real().balance("sol")) { setStatus("Not enough balance.", "err"); return; }

      go.disabled = true;
      try {
        setStatus("Sending…");
        const r = await real().withdraw("sol", v);
        refreshBal();
        amt.value = "";
        if (r && r.signature) {
          status.innerHTML =
            'Sent. <a href="' + esc(real().explorerTx(r.signature)) +
            '" target="_blank" rel="noopener">View on Solscan</a>';
          status.style.color = "#7ddc7d";
        } else {
          setStatus("Sent.", "ok");
        }
      } catch (e) {
        setStatus((e && e.message) || "Withdrawal failed.", "err");
      }
      go.disabled = false;
    });
  }

  /* =========================== ACCOUNT ===========================
     Opened from the topbar address chip. Deliberately not the
     deposit/withdraw panel: just who you are and whether you are
     signed in, with the one action that flips it. */

  function accountBody() {
    const a = addr();
    const canReal = realEnabled();
    const on = realOn();
    return (
      '<div class="wp">' +
        '<div class="wp-block">' +
          "<h4>Wallet address</h4>" +
          '<div class="wp-addr"><code id="wpAddr">' + esc(a) + "</code>" +
          '<button class="btn btn--gold" id="wpCopy">Copy</button></div>' +
        "</div>" +
        (canReal
          ? '<div class="wp-block">' +
              "<h4>Session</h4>" +
              (on
                ? '<p class="wp-lead">Signed in — your casino balance is open.</p>' +
                  '<button class="btn btn--glass" id="wpAcctOut">Log out</button>'
                : '<p class="wp-lead">Signed out. Sign a one-time message to reopen ' +
                  "your casino balance. It costs nothing and moves nothing.</p>" +
                  '<button class="btn btn--gold" id="wpAcctIn">Sign in with wallet</button>') +
              statusSlot() +
            "</div>"
          : "") +
      "</div>"
    );
  }

  function mountAccount(h) {
    const root = h && h.panel ? h.panel : document;
    const box = root.querySelector("#wpAcct");

    function paint() {
      box.innerHTML = accountBody();
      wireCopy(root);
      const status = root.querySelector("#wpStatus");
      const out = root.querySelector("#wpAcctOut");
      if (out) {
        out.addEventListener("click", function () {
          real().signOut();
          paint();
        });
      }
      const sin = root.querySelector("#wpAcctIn");
      if (sin) {
        sin.addEventListener("click", function () {
          sin.disabled = true;
          real().signIn().then(paint, function (e) {
            sin.disabled = false;
            if (status) status.textContent = (e && e.message) || "Sign-in failed.";
          });
        });
      }
    }
    paint();
  }

  function openAccount() {
    if (!window.PepeModal) return;
    if (!addr()) {
      if (window.PepeWallet) window.PepeWallet.startCreateFlow();
      return;
    }
    return window.PepeModal.open({
      title: "Account",
      subtitle: "Solana",
      size: "md",
      trust: true,
      body: '<div id="wpAcct"></div>',
      actions: [
        { label: "Close", variant: "glass", onClick: function () { window.PepeModal.close(); } },
      ],
      onMount: mountAccount,
    });
  }

  window.PepeWalletPanel = { open: open, account: openAccount };
})();
