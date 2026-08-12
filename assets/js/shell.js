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

/* One group, listing every game mode that has a page of its own.
   There is no per-category landing page: the group is the menu. */
const NAV_GROUPS = [
  {
    k: "casino", ic: "chip", t: "Casino", open: true,
    items: [
      { k: "plinko", ic: "plinko", t: "Plinko", href: B + "games/plinko.html" },
      { k: "mines", ic: "bomb", t: "Mines", href: B + "games/mines.html" },
      { k: "dice", ic: "dice", t: "Dice", href: B + "games/dice.html" },
      { k: "crash", ic: "rocket", t: "Crash", href: B + "games/crash.html" },
      { k: "limbo", ic: "chart", t: "Limbo", href: B + "games/limbo.html" },
      { k: "wheel", ic: "wheel", t: "Wheel", href: B + "games/wheel.html" },
      { k: "blackjack", ic: "spade", t: "Blackjack", href: B + "games/blackjack.html" },
    ],
  },
];

const NAV_FOOT = [
  { k: "rewards", ic: "shield", t: "Rewards", href: B + "pages/promotions.html" },
  { k: "token", ic: "coin", t: "$FAIL Token", href: B + "token.html", mod: "token" },
];

/* --- Single nav entry --- */
function navItem(n) {
  const active = n.k === PAGE.active ? " active" : "";
  const mod = n.mod ? " nav__item--" + n.mod : "";
  const pill = n.pill
    ? `<span class="badge-pill${n.pillMod ? " badge-pill--" + n.pillMod : ""}">${n.pill}</span>`
    : "";
  return `<a class="nav__item${mod}${active}" href="${n.href}">${icon(n.ic)}<span>${n.t}</span>${pill}</a>`;
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
    subtitle: "Casino",
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
      <button class="is-locked" disabled aria-disabled="true" title="Sportsbook — coming soon">
        ${icon("lock", 2)}<span>Sports</span>
      </button>
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
      <div class="promo-card__amount">$0</div>
      <div class="promo-card__label">WEEKLY DRAW</div>
    </div>

    <div class="stats">
      <div class="stat"><div class="stat__k">Daily</div><div class="stat__v">$0</div></div>
      <div class="stat"><div class="stat__k">Weekly</div><div class="stat__v">$0</div></div>
      <div class="stat"><div class="stat__k">Monthly</div><div class="stat__v">$0</div></div>
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

  /* Floating support button — support runs on X, there is no ticket desk */
  const fab = document.createElement("a");
  fab.className = "fab";
  fab.title = "Support — @pepebetsupport on X";
  fab.href = "https://x.com/pepebetsupport";
  fab.target = "_blank";
  fab.rel = "noopener noreferrer";
  fab.innerHTML = icon("headset", 2);
  document.body.appendChild(fab);
}

/* ===================================================================
   SITE FOOTER
   Pages carry an empty <div class="foot"></div>; it is replaced here so
   the footer only lives in one place.
   =================================================================== */
const FOOT_COLS = [
  {
    t: "Platform",
    links: [
      { t: "Originals", href: B + "casino.html#originals" },
      { t: "Blackjack", href: B + "games/blackjack.html" },
      { t: "Rewards", href: B + "pages/promotions.html" },
      { t: "$FAIL Token", href: B + "token.html" },
    ],
  },
  {
    t: "Legal",
    links: [
      { t: "Terms and Conditions", href: B + "pages/terms.html" },
      { t: "Privacy Policy", href: B + "pages/privacy.html" },
      { t: "Responsible Gaming", href: B + "pages/responsible.html" },
      { t: "Provably Fair", href: B + "pages/provably-fair.html" },
    ],
  },
  {
    t: "Community",
    links: [
      { t: "X — @pepefail", href: "https://x.com/pepefail", ext: true },
      { t: "Support — @pepebetsupport", href: "https://x.com/pepebetsupport", ext: true },
    ],
  },
];

function renderFooter() {
  const slot = document.querySelector(".foot");
  if (!slot) return;

  const cols = FOOT_COLS.map(function (c) {
    const links = c.links
      .map(function (l) {
        const ext = l.ext ? ' target="_blank" rel="noopener noreferrer"' : "";
        return '<li><a href="' + l.href + '"' + ext + ">" + l.t + "</a></li>";
      })
      .join("");
    return '<div class="sfoot__col"><h3>' + c.t + "</h3><ul>" + links + "</ul></div>";
  }).join("");

  const foot = document.createElement("footer");
  foot.className = "sfoot";
  foot.innerHTML =
    '<div class="sfoot__grid">' +
      '<div class="sfoot__brand">' +
        '<a class="sfoot__logo" href="' + B + 'casino.html">' +
          '<img src="' + B + 'assets/img/logo.png" alt="" />' +
          '<span>pepe<b>.fail</b></span>' +
        "</a>" +
        "<p>pepe.fail is a decentralised casino on Solana. Funds stay in your own " +
        "non-custodial wallet — there is no operator account holding your balance.</p>" +
        "<p>Gambling can be addictive. Play responsibly and only stake what you can " +
        "afford to lose.</p>" +
        '<p class="sfoot__copy">&copy; 2026 pepe.fail. All rights reserved.</p>' +
        '<img class="sfoot__age" src="' + B + 'assets/img/age-badge.png" ' +
        'alt="Gambling for 21 years old and above only. Gambling can be addictive — know when to stop." />' +
      "</div>" +
      cols +
    "</div>";

  slot.replaceWith(foot);
}

renderShell();
renderAuth();
renderFooter();

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
