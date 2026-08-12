/* ===================================================================
   pepe.fail — wallet panel

   Deposit and withdraw, plus a plain statement of what the casino
   actually accepts: Solana only, SOL only for now, $FAIL once it is
   live. Nothing else is listed, because sending anything else would
   lose the funds.

   Balances here are play credits until real deposits are wired. That
   is said on the panel rather than implied.
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

  /* =========================== MARKUP =========================== */

  function chainRows() {
    return CHAINS.map(function (c) {
      return (
        '<div class="wp-row' + (c.on ? " is-on" : " is-off") + '">' +
          '<span class="wp-row__ico">' + ico(c.ic) + "</span>" +
          '<span class="wp-row__n">' + c.n + "<i>" + c.note + "</i></span>" +
          '<span class="wp-row__tag">' + (c.on ? "Supported" : "Unsupported") + "</span>" +
        "</div>"
      );
    }).join("");
  }

  function assetRows() {
    return ASSETS.map(function (a) {
      return (
        '<div class="wp-row' + (a.on ? " is-on" : " is-off") + '">' +
          '<span class="wp-row__ico">' + ico(a.ic) + "</span>" +
          '<span class="wp-row__n">' + a.n + "<i>" + a.sub + "</i></span>" +
          '<span class="wp-row__tag">' + (a.on ? "Accepted" : a.note) + "</span>" +
        "</div>"
      );
    }).join("");
  }

  function depositBody() {
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
        '<div class="wp-note">Minimum deposit ' + MIN_DEPOSIT +
        ". On-chain deposits are not wired up yet — your balance is play credits for now.</div>" +
      "</div>"
    );
  }

  function withdrawBody() {
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
        '<div class="wp-note">Withdrawals are not live yet. Nothing is sent and no balance ' +
        "is deducted — the form is here so the flow is clear before real funds exist.</div>" +
      "</div>"
    );
  }

  /* =========================== PANEL =========================== */

  function open(tab) {
    if (!window.PepeModal) return;
    const start = tab === "withdraw" ? "withdraw" : "deposit";

    const handle = window.PepeModal.open({
      title: "Wallet",
      subtitle: "Solana · non-custodial",
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

    function show(which) {
      tabs.forEach(function (t) { t.classList.toggle("is-on", t.dataset.tab === which); });
      body.innerHTML = which === "withdraw" ? withdrawBody() : depositBody();
      wire(root, which);
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () { show(t.dataset.tab); });
    });

    show(tab);
  }

  function wire(root, which) {
    if (which === "deposit") {
      const copy = root.querySelector("#wpCopy");
      const code = root.querySelector("#wpAddr");
      if (copy && code) {
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

  window.PepeWalletPanel = { open: open };
})();
