/* ===================================================================
   pepe.fail — page d'accueil
   =================================================================== */

hydrateIcons();
bindScrollers();

/* Icônes des cartes hero */
document.getElementById("hcCasino").insertAdjacentHTML("afterbegin", icon("chip", 1.9));
document.getElementById("hcSport").insertAdjacentHTML("afterbegin", icon("cards", 1.9));

/* Carrousels */
fillRow("originals", ORIGINALS);
fillRow("slots", SLOTS);
fillRow("live", LIVE_GAMES);

/* ===================================================================
   FLUX DE VICTOIRES EN DIRECT (temps réel simulé)
   =================================================================== */
const NAMES = ["Ljsi...", "7HUG...", "Slot...", "9PAP...", "Mast...", "Caché", "Zaxz...", "monk...", "Shor...", "Kermit", "Pepe...", "Frog...", "0xA1...", "Caché"];
const WIN_ICONS = ["frog", "candy", "bolt", "dice", "rocket", "bomb", "cards", "slot", "wheel", "star"];
const track = document.getElementById("liveTrack");
const MAX_CARDS = 14;

function randAmount() {
  const r = Math.random();
  let v;
  if (r > 0.94) v = 50 + Math.random() * 950;
  else if (r > 0.7) v = 5 + Math.random() * 45;
  else v = 0.1 + Math.random() * 5;
  return "$" + v.toFixed(2);
}

function pushWin() {
  const ic = WIN_ICONS[Math.floor(Math.random() * WIN_ICONS.length)];
  const orange = Math.random() > 0.6;
  const card = document.createElement("div");
  card.className = "win-card";
  card.innerHTML = `
    <div class="win-card__thumb ${orange ? "orange" : ""}">${icon(ic)}</div>
    <div class="win-card__user">${NAMES[Math.floor(Math.random() * NAMES.length)]}</div>
    <div class="win-card__amt">${randAmount()}</div>`;
  track.prepend(card);
  while (track.children.length > MAX_CARDS) track.lastChild.remove();
}

for (let i = 0; i < MAX_CARDS; i++) pushWin();
setInterval(pushWin, 2200);
