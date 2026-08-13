/* ===================================================================
   pepe.fail — search and referrals

   Two topbar panels built on PepeModal. Search filters the real game
   catalogue; referrals derive a stable code so a link can be shared
   before any backend exists.
   =================================================================== */

(function () {
  "use strict";

  const B = (window.PAGE && window.PAGE.base) || "";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* =========================== SEARCH =========================== */

  function rowHTML(g, i) {
    const art = g.img
      ? '<img src="' + B + g.img + '" alt="" loading="lazy" />'
      : '<span class="sr-row__ico">' + icon(g.ic) + "</span>";
    return (
      '<a class="sr-row" href="' + B + g.href + '" data-i="' + i + '" style="--i:' + i + '">' +
        '<span class="sr-row__art">' + art + "</span>" +
        '<span class="sr-row__txt"><b>' + esc(g.n) + "</b><i>" + esc(g.p) + "</i></span>" +
        '<span class="sr-row__go">' + icon("arrowR", 2) + "</span>" +
      "</a>"
    );
  }

  /* Substring match on name and provider. Small catalogue, so there is
     no reason to reach for anything cleverer. */
  function match(g, q) {
    if (!q) return true;
    return (g.n + " " + g.p).toLowerCase().indexOf(q) !== -1;
  }

  function openSearch() {
    if (!window.PepeModal) return;

    window.PepeModal.open({
      title: "Search",
      subtitle: "Every game on pepe.fail",
      size: "md",
      body:
        '<div class="sr">' +
          '<div class="sr-field">' +
            '<span class="sr-field__ico">' + icon("search", 2) + "</span>" +
            '<input class="sr-input" id="srInput" type="text" autocomplete="off" ' +
            'spellcheck="false" placeholder="Search games" />' +
          "</div>" +
          '<div class="sr-list" id="srList"></div>' +
          '<div class="sr-none" id="srNone" hidden>No game matches that.</div>' +
        "</div>",
      actions: [
        { label: "Close", variant: "glass", onClick: function () { window.PepeModal.close(); } },
      ],
      onMount: function (h) {
        const root = h && h.panel ? h.panel : document;
        const input = root.querySelector("#srInput");
        const list = root.querySelector("#srList");
        const none = root.querySelector("#srNone");
        /* ALL_GAMES is a top-level `const` in games-data.js, so it lives in
           script scope and never lands on `window`. */
        const games = (typeof ALL_GAMES !== "undefined" && ALL_GAMES) || [];

        list.innerHTML = games.map(rowHTML).join("");
        const rows = Array.prototype.slice.call(list.querySelectorAll(".sr-row"));

        function apply() {
          const q = input.value.trim().toLowerCase();
          let shown = 0;
          rows.forEach(function (r, i) {
            const on = match(games[i], q);
            /* keep the node in flow while it fades, then pull it out */
            r.classList.toggle("is-out", !on);
            if (on) { r.style.setProperty("--i", shown); shown++; }
          });
          none.hidden = shown > 0;
        }

        input.addEventListener("input", apply);

        /* Enter opens the first visible result. */
        input.addEventListener("keydown", function (e) {
          if (e.key !== "Enter") return;
          const first = rows.filter(function (r) { return !r.classList.contains("is-out"); })[0];
          if (first) window.location.href = first.getAttribute("href");
        });

        window.setTimeout(function () { input.focus(); }, 60);
      },
    });
  }

  /* =========================== REFERRALS =========================== */

  const REF_KEY = "pepe.ref";

  /* Prefer the wallet address so the code survives a cleared cache;
     fall back to a stored random one when there is no wallet yet. */
  function refCode() {
    let addr = null;
    try {
      const w = window.PepeWallet && window.PepeWallet.get && window.PepeWallet.get();
      addr = w ? w.address || w.publicKey || (typeof w === "string" ? w : null) : null;
    } catch (e) { addr = null; }

    if (addr) return addr.slice(0, 8).toUpperCase();

    try {
      let c = window.localStorage.getItem(REF_KEY);
      if (!c) {
        const b = new Uint8Array(4);
        (window.crypto || {}).getRandomValues
          ? window.crypto.getRandomValues(b)
          : b.set([1, 2, 3, 4]);
        c = Array.prototype.map
          .call(b, function (n) { return n.toString(16).padStart(2, "0"); })
          .join("")
          .toUpperCase();
        window.localStorage.setItem(REF_KEY, c);
      }
      return c;
    } catch (e) {
      return "PEPEFAIL";
    }
  }

  function openReferrals() {
    if (!window.PepeModal) return;

    const code = refCode();
    const link = location.origin + "/?ref=" + code;

    /* the share follows your rank, so it is read from the engine rather
       than written twice */
    const E = window.PepeEngine;
    const rank = E && E.Rank ? E.Rank.current() : null;
    const share = rank ? rank.ref : 25;

    window.PepeModal.open({
      title: "Referrals",
      subtitle: "Earn from the house edge your invites pay",
      size: "md",
      trust: true,
      body:
        '<div class="rf">' +
          '<div class="rf-block">' +
            "<h4>Your link</h4>" +
            '<div class="rf-copy"><code id="rfLink">' + esc(link) + "</code>" +
            '<button class="btn btn--gold" id="rfCopy">Copy</button></div>' +
            '<div class="rf-code">Code <b>' + esc(code) + "</b></div>" +
          "</div>" +

          '<div class="rf-stats">' +
            '<div class="rf-stat"><span>Invited</span><b>0</b></div>' +
            '<div class="rf-stat"><span>Wagered by invites</span><b>0.00</b></div>' +
            '<div class="rf-stat"><span>Earned</span><b>0.00</b></div>' +
          "</div>" +

          '<div class="rf-block">' +
            "<h4>How it works</h4>" +
            '<ol class="rf-steps">' +
              "<li>Share your link. Anyone opening it is tied to your code on their device.</li>" +
              "<li>They play. Every wager pays the house a one percent edge.</li>" +
              "<li>You take <b>" + share + "% of that edge</b>, for as long as they keep playing.</li>" +
            "</ol>" +
            '<p class="rf-note">Your share rises with your rank' +
            (rank ? " — " + share + "% at " + esc(rank.n) : "") +
            '. See the <a href="' + B + 'pages/promotions.html">rank ladder</a>.<br>' +
            "You earn from the fee they already pay, not from their losses. " +
            "Nothing is taken out of their balance to fund it.</p>" +
          "</div>" +
        "</div>",
      actions: [
        { label: "Close", variant: "glass", onClick: function () { window.PepeModal.close(); } },
      ],
      onMount: function (h) {
        const root = h && h.panel ? h.panel : document;
        const btn = root.querySelector("#rfCopy");
        if (!btn) return;

        btn.addEventListener("click", async function () {
          let ok = false;
          try { await navigator.clipboard.writeText(link); ok = true; }
          catch (e) {
            const ta = document.createElement("textarea");
            ta.value = link; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select();
            try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
            ta.remove();
          }
          const before = btn.textContent;
          btn.textContent = ok ? "Copied" : "Copy failed";
          window.setTimeout(function () { btn.textContent = before; }, 1400);
        });
      },
    });
  }

  window.PepeSearch = { open: openSearch };
  window.PepeReferrals = { open: openReferrals };
})();
