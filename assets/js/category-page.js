/* ===================================================================
   pepe.fail — pages catégories (UI uniquement)
   Chaque page définit window.CAT = "<clé>" avant de charger ce script.
   =================================================================== */

const CATS = {
  slots: {
    title: "Machines à sous",
    ic: "slot",
    sub: "Des centaines de machines à sous des meilleurs studios.",
    filters: ["Tout", "Populaires", "Nouveautés", "Jackpots", "Megaways", "Bonus Buy"],
    list: () => SLOTS.concat(SLOTS.slice(0, 6)),
  },
  live: {
    title: "Jeux en Direct",
    ic: "cards",
    sub: "Croupiers en direct, 24h/24 — roulette, blackjack et jeux TV.",
    filters: ["Tout", "Roulette", "Blackjack", "Baccarat", "Game Shows"],
    list: () => LIVE_GAMES.concat(LIVE_GAMES.slice(0, 4)),
  },
  nouveautes: {
    title: "Nouvelles Sorties",
    ic: "sparkle",
    sub: "Les derniers jeux ajoutés sur pepe.fail.",
    filters: ["Tout", "Cette semaine", "Ce mois-ci", "Originaux"],
    list: () => ORIGINALS.concat(SLOTS.slice(0, 8)),
  },
  favoris: {
    title: "Favoris",
    ic: "star",
    sub: "Les jeux que vous avez épinglés.",
    filters: ["Tout", "Originaux", "Machines à sous", "En Direct"],
    list: () => ORIGINALS.slice(0, 6).concat(SLOTS.slice(0, 4)),
  },
  recent: {
    title: "Joué Récemment",
    ic: "clock",
    sub: "Reprenez là où vous vous étiez arrêté.",
    filters: ["Tout", "Aujourd'hui", "Cette semaine"],
    list: () => ORIGINALS.slice(0, 4).concat(SLOTS.slice(2, 10)),
  },
};

(function mountCategory() {
  const c = CATS[window.CAT];
  if (!c) return;

  document.getElementById("pageHead").innerHTML = `
    <h1><span style="display:inline-grid;place-items:center;width:34px;height:34px;vertical-align:-6px;color:var(--gold);margin-right:6px">${icon(c.ic)}</span>${c.title}</h1>
    <p>${c.sub}</p>`;

  document.getElementById("filters").innerHTML = c.filters
    .map((f, i) => `<button class="${i === 0 ? "active" : ""}">${f}</button>`)
    .join("");

  const grid = document.getElementById("grid");
  c.list().forEach((g) => grid.appendChild(gameCard(g, "../")));

  document.title = `${c.title} — pepe.fail`;

  document.querySelectorAll("#filters button").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#filters button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    });
  });
})();
