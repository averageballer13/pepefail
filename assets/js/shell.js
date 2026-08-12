/* ===================================================================
   pepe.fail — shell partagé (brand + topbar + sidebar)
   Chaque page définit window.PAGE = { active: "<clé>", base: "" | "../" }
   avant de charger ce script.
   =================================================================== */
const PAGE = window.PAGE || { active: "home", base: "" };
const B = PAGE.base || "";

/* --- Arborescence de navigation --- */
const NAV_MAIN = [
  { k: "home", ic: "home", t: "Accueil", href: B + "index.html" },
  { k: "favoris", ic: "star", t: "Favoris", href: B + "pages/favoris.html" },
  { k: "recent", ic: "clock", t: "Joué Récemment", href: B + "pages/recent.html" },
  { k: "new", ic: "sparkle", t: "Nouvelles Sorties", href: B + "pages/nouveautes.html" },
];

const NAV_GROUPS = [
  {
    k: "casino", ic: "chip", t: "Casino", open: true,
    items: [
      { k: "slots", ic: "slot", t: "Machines à sous", href: B + "pages/slots.html" },
      { k: "live", ic: "cards", t: "Jeux en Direct", href: B + "pages/live.html" },
      { k: "blackjack", ic: "spade", t: "Blackjack", href: B + "pages/live.html" },
      { k: "roulette", ic: "wheel", t: "Roulette", href: B + "pages/live.html" },
    ],
  },
  {
    k: "originaux", ic: "diamond", t: "Originaux", open: true,
    items: [
      { k: "plinko", ic: "plinko", t: "Plinko", href: B + "jeux/plinko.html" },
      { k: "mines", ic: "bomb", t: "Mines", href: B + "jeux/mines.html" },
      { k: "dice", ic: "dice", t: "Dice", href: B + "jeux/dice.html" },
      { k: "crash", ic: "rocket", t: "Crash", href: B + "jeux/crash.html" },
      { k: "limbo", ic: "chart", t: "Limbo", href: B + "jeux/limbo.html" },
      { k: "wheel", ic: "wheel", t: "Wheel", href: B + "jeux/wheel.html" },
    ],
  },
  {
    k: "promos", ic: "gift", t: "Promotions", open: true,
    items: [
      { k: "vip", ic: "crown", t: "VIP", href: B + "pages/promotions.html", pill: "EXCLUSIF", pillMod: "gold" },
      { k: "cq", ic: "trophy", t: "Course Quotidienne", href: B + "pages/promotions.html", pill: "01:01", pillMod: "live" },
      { k: "ch", ic: "trophy", t: "Course Hebdo", href: B + "pages/promotions.html", pill: "3j" },
      { k: "cm", ic: "diamond", t: "Course Mensuelle", href: B + "pages/promotions.html", pill: "20j" },
      { k: "defis", ic: "target", t: "Défis", href: B + "pages/promotions.html" },
    ],
  },
];

const NAV_FOOT = [
  { k: "rewards", ic: "shield", t: "Récompenses", href: B + "pages/promotions.html" },
  { k: "blog", ic: "book", t: "Blog", href: B + "pages/promotions.html" },
];

/* --- Rendu d'un élément de nav --- */
function navItem(n, sub) {
  const active = n.k === PAGE.active ? " active" : "";
  const pill = n.pill
    ? `<span class="badge-pill${n.pillMod ? " badge-pill--" + n.pillMod : ""}">${n.pill}</span>`
    : "";
  return `<a class="nav__item${active}" href="${n.href}">${icon(n.ic)}<span>${n.t}</span>${pill}</a>`;
}

/* --- Construction du shell --- */
function renderShell() {
  /* Brand */
  const brand = document.createElement("div");
  brand.className = "brand";
  brand.innerHTML = `
    <a href="${B}index.html" style="display:flex;align-items:center;gap:10px">
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
    <button class="icon-btn" title="Rechercher">${icon("search", 2)}</button>
    <button class="icon-btn" title="Cadeaux">${icon("gift", 2)}</button>
    <button class="btn btn--ghost">Connexion</button>
    <button class="btn btn--orange">S'inscrire</button>
    <button class="icon-btn" title="Chat">${icon("chat", 2)}</button>`;

  /* Sidebar */
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `
    <div class="promo-card">
      <div class="promo-card__ico">${icon("ticket")}</div>
      <div class="promo-card__badge">4j</div>
      <div class="promo-card__amount">$20 000</div>
      <div class="promo-card__label">TIRAGE HEBDO</div>
    </div>

    <div class="stats">
      <div class="stat"><div class="stat__k">Quotidien</div><div class="stat__v">$25K</div></div>
      <div class="stat"><div class="stat__k">Hebdo</div><div class="stat__v">$100K</div></div>
      <div class="stat"><div class="stat__k">Mensuel</div><div class="stat__v">$500K</div></div>
    </div>

    <nav class="nav">
      ${NAV_MAIN.map((n) => navItem(n)).join("")}
      ${NAV_GROUPS.map((g) => {
        const hasActive = g.items.some((i) => i.k === PAGE.active);
        return `
        <div class="nav__group${g.open || hasActive ? " open" : ""}" data-group>
          <a class="nav__item" data-toggle>${icon(g.ic)}<span>${g.t}</span><span class="chev">${icon("chevron", 2)}</span></a>
          <div class="nav__sub">${g.items.map((i) => navItem(i, true)).join("")}</div>
        </div>`;
      }).join("")}
      <div class="nav__divider"></div>
      ${NAV_FOOT.map((n) => navItem(n)).join("")}
    </nav>`;

  const app = document.querySelector(".app");
  app.prepend(sidebar);
  app.prepend(topbar);
  app.prepend(brand);

  /* Bouton support flottant */
  const fab = document.createElement("button");
  fab.className = "fab";
  fab.title = "Support";
  fab.innerHTML = icon("headset", 2);
  document.body.appendChild(fab);
}

renderShell();

/* --- Interactions du shell --- */
document.querySelectorAll("[data-group] [data-toggle]").forEach((t) => {
  t.addEventListener("click", () => t.closest("[data-group]").classList.toggle("open"));
});

document.querySelectorAll(".seg button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".seg button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  });
});
