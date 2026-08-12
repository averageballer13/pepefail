/* ===================================================================
   pepe.fail — shared shell (brand + topbar + sidebar)
   Every page sets window.PAGE = { active: "<key>", base: "" | "../" }
   before loading this script.
   =================================================================== */
const PAGE = window.PAGE || { active: "home", base: "" };
const B = PAGE.base || "";

/* Monospace stack used for the truncated wallet address. */
const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/* --- Navigation tree --- */
const NAV_MAIN = [
  { k: "home", ic: "home", t: "Home", href: B + "casino.html" },
  { k: "recent", ic: "clock", t: "Recently Played", href: B + "pages/recent.html" },
];

const NAV_GROUPS = [
  {
    k: "casino", ic: "chip", t: "Casino", open: true,
    items: [
      { k: "slots", ic: "slot", t: "Slots", href: B + "pages/slots.html" },
      { k: "live", ic: "cards", t: "Live Games", href: B + "pages/live.html" },
      { k: "blackjack", ic: "spade", t: "Blackjack", href: B + "games/blackjack.html" },
      { k: "roulette", ic: "wheel", t: "Roulette", href: B + "pages/live.html" },
    ],
  },
];

const NAV_FOOT = [
  { k: "rewards", ic: "shield", t: "Rewards", href: B + "pages/promotions.html" },
  { k: "landing", ic: "sparkle", t: "Landing", href: B + "index.html" },
];

/* --- Single nav entry --- */
function navItem(n) {
  const active = n.k === PAGE.active ? " active" : "";
  const pill = n.pill
    ? `<span class="badge-pill${n.pillMod ? " badge-pill--" + n.pillMod : ""}">${n.pill}</span>`
    : "";
  return `<a class="nav__item${active}" href="${n.href}">${icon(n.ic)}<span>${n.t}</span>${pill}</a>`;
}

/* ===================================================================
   WALLET AREA (topbar right side)
   =================================================================== */

/* Returns the current wallet address, or null when no wallet exists. */
function walletAddress() {
  const w = window.PepeWallet;
  if (!w || typeof w.get !== "function") return null;
  let acc = null;
  try {
    acc = w.get();
  } catch (e) {
    return null;
  }
  if (!acc) return null;
  if (typeof acc === "string") return acc;
  return acc.address || acc.publicKey || null;
}

/* First 4 + last 4 characters. */
function shortAddress(addr) {
  const a = String(addr);
  return a.length <= 10 ? a : a.slice(0, 4) + "…" + a.slice(-4);
}

/* Opens the log-in explainer modal (this mockup has no accounts). */
function openLogInModal() {
  if (!window.PepeModal) return;
  window.PepeModal.open({
    title: "Log In",
    subtitle: "Demo mockup — no real accounts",
    body:
      "<p>pepe.fail runs entirely in your browser. There is no account to sign into — " +
      "create a local wallet instead and your balance stays on this device.</p>",
    size: "sm",
    trust: true,
    actions: [
      {
        label: "Create Wallet",
        variant: "gold",
        onClick: function () {
          window.PepeModal.close();
          if (window.PepeWallet) window.PepeWallet.startCreateFlow();
        },
      },
      { label: "Close", variant: "glass", onClick: function () { window.PepeModal.close(); } },
    ],
  });
}

/* Renders either Log In + Create Wallet, or the connected wallet chip. */
function renderAuth() {
  const slot = document.getElementById("topbarAuth");
  if (!slot) return;
  slot.innerHTML = "";

  const addr = walletAddress();

  if (addr) {
    const chip = document.createElement("button");
    chip.className = "btn btn--glass";
    chip.title = "Open wallet";
    chip.style.fontFamily = MONO_STACK;
    chip.style.letterSpacing = ".01em";
    chip.textContent = shortAddress(addr);
    chip.addEventListener("click", function () {
      if (window.PepeWallet) window.PepeWallet.open();
    });
    slot.appendChild(chip);
    return;
  }

  const login = document.createElement("button");
  login.className = "btn btn--glass";
  login.textContent = "Log In";
  login.addEventListener("click", openLogInModal);

  const create = document.createElement("button");
  create.className = "btn btn--gold";
  create.textContent = "Create Wallet";
  create.addEventListener("click", function () {
    if (window.PepeWallet) window.PepeWallet.startCreateFlow();
  });

  slot.appendChild(login);
  slot.appendChild(create);
}

/* ===================================================================
   SHELL MARKUP
   =================================================================== */
function renderShell() {
  /* Brand */
  const brand = document.createElement("div");
  brand.className = "brand";
  brand.innerHTML = `
    <a href="${B}casino.html" style="display:flex;align-items:center;gap:10px">
      <img class="brand__logo" src="${B}assets/img/logo.png" alt="pepe.fail" />
      <div class="brand__name">pepe<b>.fail</b></div>
    </a>`;

  /* Topbar */
  const topbar = document.createElement("header");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <div class="seg">
      <button class="active">Casino</button>
      <button>Sports</button>
    </div>
    <div class="topbar__spacer"></div>
    <button class="icon-btn glass" title="Search">${icon("search", 2)}</button>
    <button class="icon-btn glass" title="Rewards">${icon("gift", 2)}</button>
    <div class="topbar__auth" id="topbarAuth"></div>
    <button class="icon-btn glass" title="Chat">${icon("chat", 2)}</button>`;

  /* Sidebar */
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `
    <div class="promo-card">
      <div class="promo-card__ico">${icon("ticket")}</div>
      <div class="promo-card__badge">4d</div>
      <div class="promo-card__amount">$20,000</div>
      <div class="promo-card__label">WEEKLY DRAW</div>
    </div>

    <div class="stats">
      <div class="stat"><div class="stat__k">Daily</div><div class="stat__v">$25K</div></div>
      <div class="stat"><div class="stat__k">Weekly</div><div class="stat__v">$100K</div></div>
      <div class="stat"><div class="stat__k">Monthly</div><div class="stat__v">$500K</div></div>
    </div>

    <nav class="nav">
      ${NAV_MAIN.map((n) => navItem(n)).join("")}
      ${NAV_GROUPS.map((g) => {
        const hasActive = g.items.some((i) => i.k === PAGE.active);
        return `
        <div class="nav__group${g.open || hasActive ? " open" : ""}" data-group>
          <a class="nav__item" data-toggle>${icon(g.ic)}<span>${g.t}</span><span class="chev">${icon("chevron", 2)}</span></a>
          <div class="nav__sub">${g.items.map((i) => navItem(i)).join("")}</div>
        </div>`;
      }).join("")}
      <div class="nav__divider"></div>
      ${NAV_FOOT.map((n) => navItem(n)).join("")}
    </nav>`;

  const app = document.querySelector(".app");
  app.prepend(sidebar);
  app.prepend(topbar);
  app.prepend(brand);

  /* Floating support button */
  const fab = document.createElement("button");
  fab.className = "fab";
  fab.title = "Support";
  fab.innerHTML = icon("headset", 2);
  document.body.appendChild(fab);
}

renderShell();
renderAuth();

/* wallet.js loads after this file, so re-render once every script has run,
   then on every wallet state change. */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderAuth);
}
document.addEventListener("pepe:wallet", renderAuth);

/* --- Shell interactions --- */
document.querySelectorAll("[data-group] [data-toggle]").forEach((t) => {
  t.addEventListener("click", () => t.closest("[data-group]").classList.toggle("open"));
});

document.querySelectorAll(".seg button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".seg button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  });
});
