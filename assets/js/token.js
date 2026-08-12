/* ===================================================================
   pepe.fail — $FAIL token page

   Set TOKEN_CA to the mint address once the coin is live. While it is
   empty the page says so and the copy button stays disabled, so nobody
   can copy a placeholder and send funds to it.
   =================================================================== */

/* ------------------------------------------------------------------
   EDIT THIS ONE LINE AT LAUNCH
   ------------------------------------------------------------------ */
const TOKEN_CA = "";

hydrateIcons();

/* =========================== LIVE CHART ===========================
   Swaps the placeholder for the Pump.fun embed as soon as TOKEN_CA is
   set. Nothing else to change at launch. */
(function () {
  const host = document.getElementById("tkChart");
  const state = document.getElementById("chartState");
  const ca = TOKEN_CA.trim();
  if (!host || !ca) return;

  const frame = document.createElement("iframe");
  frame.src = "https://pump.fun/coin/" + encodeURIComponent(ca) + "?embed=1";
  frame.title = "$FAIL live chart";
  frame.loading = "lazy";
  frame.allow = "clipboard-write";
  frame.referrerPolicy = "no-referrer";

  host.innerHTML = "";
  host.appendChild(frame);
  if (state) state.textContent = "Live";
})();

/* =========================== CONTRACT ADDRESS =========================== */
(function () {
  const value = document.getElementById("caValue");
  const copy = document.getElementById("caCopy");
  const note = document.getElementById("caNote");
  if (!value || !copy) return;

  const ca = TOKEN_CA.trim();

  if (!ca) {
    value.textContent = "Not live yet";
    value.classList.add("is-empty");
    copy.disabled = true;
    return;
  }

  value.textContent = ca;
  value.dataset.ca = ca;
  value.classList.remove("is-empty");
  copy.disabled = false;

  copy.addEventListener("click", async function () {
    let ok = false;
    try {
      await navigator.clipboard.writeText(ca);
      ok = true;
    } catch (e) {
      /* clipboard refuses when the document is not focused; fall back */
      const ta = document.createElement("textarea");
      ta.value = ca;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
    }

    const before = copy.textContent;
    copy.textContent = ok ? "Copied" : "Copy failed";
    window.setTimeout(function () { copy.textContent = before; }, 1400);
    if (note && ok) note.textContent = "Address copied. Always check it against the official links.";
  });
})();

/* =========================== FEE ROUTING =========================== */
const SPLITS = {
  fees: [
    { n: "Buyback", pct: 50, tone: "", d: "Spent on the open market, then locked in the bankroll vault." },
    { n: "Bankroll", pct: 30, tone: "orange", d: "Raises the maximum bet and the largest payout the house can cover." },
    { n: "Operations", pct: 20, tone: "mute", d: "Hosting, game providers, audits and listings." },
  ],
  ggr: [
    { n: "Buyback", pct: 40, tone: "", d: "House edge converted straight into buy pressure." },
    { n: "Bankroll", pct: 40, tone: "orange", d: "Reserves grow with the player base instead of lagging it." },
    { n: "Team", pct: 20, tone: "mute", d: "Development and support." },
  ],
};

Object.keys(SPLITS).forEach(function (key) {
  const host = document.querySelector('[data-rows="' + key + '"]');
  if (!host) return;

  host.innerHTML = SPLITS[key]
    .map(function (r) {
      const tone = r.tone ? " tk-row--" + r.tone : "";
      return (
        '<div class="tk-row' + tone + '">' +
          '<div class="tk-row__top">' +
            '<span class="tk-row__name">' + r.n + "</span>" +
            '<span class="tk-row__pct">' + r.pct + "%</span>" +
          "</div>" +
          '<div class="tk-row__track"><div class="tk-row__fill" style="width:' + r.pct + '%"></div></div>' +
          '<div class="tk-row__desc">' + r.d + "</div>" +
        "</div>"
      );
    })
    .join("");
});

/* =========================== HOLDER TIERS =========================== */
const TIERS = [
  {
    n: "Tadpole", ic: "chip", hold: "Any balance",
    perks: ["5% rakeback", "Weekly draw entry"],
  },
  {
    n: "Frog", ic: "frog", hold: "0.1% of supply",
    perks: ["10% rakeback", "+2% RTP on originals", "Higher table limits"],
  },
  {
    n: "Golden Frog", ic: "star", hold: "0.5% of supply",
    perks: ["15% rakeback", "Raised max bet", "Early access to new games"],
  },
  {
    n: "King Pepe", ic: "crown", hold: "1% of supply", top: true,
    perks: ["20% rakeback", "Highest limits", "Private table access", "Direct line to the team"],
  },
];

const tiersHost = document.getElementById("tiers");
if (tiersHost) {
  tiersHost.innerHTML = TIERS.map(function (t) {
    const perks = t.perks.map(function (p) { return "<li>" + p + "</li>"; }).join("");
    return (
      '<div class="tk-tier' + (t.top ? " tk-tier--top" : "") + '">' +
        '<div class="tk-tier__ico">' + icon(t.ic) + "</div>" +
        '<div class="tk-tier__n">' + t.n + "</div>" +
        '<div class="tk-tier__hold">' + t.hold + "</div>" +
        "<ul>" + perks + "</ul>" +
      "</div>"
    );
  }).join("");
}
