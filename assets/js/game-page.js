/* ===================================================================
   pepe.fail — moteur des pages de jeu (UI uniquement)
   Chaque page définit window.GAME = "<clé>" avant de charger ce script.
   =================================================================== */

/* --- Bloc de contrôle réutilisable --- */
function fieldSelect(label, options, activeIdx) {
  return `
  <div class="field">
    <div class="field__label">${label}</div>
    <div class="chips" data-chipgroup>
      ${options.map((o, i) => `<button class="${i === (activeIdx || 0) ? "active" : ""}">${o}</button>`).join("")}
    </div>
  </div>`;
}

function fieldInput(label, value, right, mini) {
  return `
  <div class="field">
    <div class="field__label">${label}${right ? `<b>${right}</b>` : ""}</div>
    <div class="input-wrap">
      <span class="cur">${icon("coin")}</span>
      <input type="text" value="${value}" />
      ${mini ? `<button class="mini">½</button><button class="mini">2×</button>` : ""}
    </div>
  </div>`;
}

/* ===================================================================
   CONFIGURATION DES JEUX
   =================================================================== */
const GAMES = {
  plinko: {
    name: "Plinko",
    ic: "plinko",
    sub: "pepe.fail Originals",
    stats: [["99%", "RTP"], ["1000×", "Gain max"]],
    controls: () =>
      fieldInput("Montant de la mise", "1.00", "$1.00", true) +
      fieldSelect("Risque", ["Faible", "Moyen", "Élevé"], 1) +
      fieldSelect("Lignes", ["8", "10", "12", "16"], 3),
    payout: ["Gain potentiel", "1000.00×"],
    action: "Lancer la bille",
    stage: stagePlinko,
    hint: "Cliquez pour lâcher une bille — plus elle tombe sur les bords, plus le multiplicateur est élevé.",
  },

  mines: {
    name: "Mines",
    ic: "bomb",
    sub: "pepe.fail Originals",
    stats: [["99%", "RTP"], ["24 610×", "Gain max"]],
    controls: () =>
      fieldInput("Montant de la mise", "1.00", "$1.00", true) +
      fieldSelect("Nombre de mines", ["1", "3", "5", "10"], 1) +
      fieldInput("Gains", "0.00", "0.00×", false),
    payout: ["Prochain gain", "1.08×"],
    action: "Parier",
    stage: stageMines,
    hint: "Retournez les cases sans tomber sur une mine, puis encaissez quand vous voulez.",
  },

  dice: {
    name: "Dice",
    ic: "dice",
    sub: "pepe.fail Originals",
    stats: [["99%", "RTP"], ["9900×", "Gain max"]],
    controls: () =>
      fieldInput("Montant de la mise", "1.00", "$1.00", true) +
      fieldInput("Gain sur victoire", "1.98", "1.98×", false) +
      fieldSelect("Rouler", ["Sous", "Au-dessus"], 1),
    payout: ["Chance de gain", "49.50%"],
    action: "Lancer les dés",
    stage: stageDice,
    hint: "Déplacez le curseur pour ajuster votre seuil — plus le risque est élevé, plus le gain l'est aussi.",
  },

  crash: {
    name: "Crash",
    ic: "rocket",
    sub: "pepe.fail Originals",
    stats: [["99%", "RTP"], ["1 000 000×", "Gain max"]],
    controls: () =>
      fieldInput("Montant de la mise", "1.00", "$1.00", true) +
      fieldInput("Retrait automatique", "2.00", "2.00×", false) +
      fieldSelect("Mode", ["Manuel", "Auto"], 0),
    payout: ["Gain potentiel", "2.00×"],
    action: "Parier",
    stage: stageCrash,
    hint: "Encaissez avant que la fusée ne s'écrase — sinon la mise est perdue.",
  },

  limbo: {
    name: "Limbo",
    ic: "chart",
    sub: "pepe.fail Originals",
    stats: [["99%", "RTP"], ["1 000 000×", "Gain max"]],
    controls: () =>
      fieldInput("Montant de la mise", "1.00", "$1.00", true) +
      fieldInput("Multiplicateur cible", "2.00", "2.00×", false),
    payout: ["Chance de gain", "49.50%"],
    action: "Parier",
    stage: stageLimbo,
    hint: "Choisissez un multiplicateur cible — le tirage doit le dépasser pour gagner.",
  },

  wheel: {
    name: "Wheel",
    ic: "wheel",
    sub: "pepe.fail Originals",
    stats: [["99%", "RTP"], ["50×", "Gain max"]],
    controls: () =>
      fieldInput("Montant de la mise", "1.00", "$1.00", true) +
      fieldSelect("Risque", ["Faible", "Moyen", "Élevé"], 1) +
      fieldSelect("Segments", ["10", "20", "30", "50"], 1),
    payout: ["Gain potentiel", "9.90×"],
    action: "Faire tourner",
    stage: stageWheel,
    hint: "Faites tourner la roue et misez sur le segment gagnant.",
  },
};

/* ===================================================================
   RENDUS DE SCÈNE
   =================================================================== */

/* --- PLINKO : pyramide de picots + rangée de multiplicateurs --- */
function stagePlinko() {
  let rows = "";
  for (let r = 3; r <= 13; r++) {
    rows += `<div class="peg-row">${'<div class="peg"></div>'.repeat(r)}</div>`;
  }
  const mults = ["110×", "41×", "10×", "5×", "3×", "1.5×", "1×", "0.5×", "1×", "1.5×", "3×", "5×", "10×", "41×", "110×"];
  const cells = mults
    .map((m, i) => {
      const edge = Math.min(i, mults.length - 1 - i);
      const cls = edge <= 1 ? "m-hi" : edge >= 5 ? "m-lo" : "";
      return `<div class="mult ${cls}">${m}</div>`;
    })
    .join("");
  return `<div class="plinko"><div class="pegs">${rows}</div><div class="mults">${cells}</div></div>`;
}

/* --- MINES : grille 5×5 --- */
function stageMines() {
  const revealed = { 6: "gem", 8: "gem", 12: "gem", 17: "mine", 21: "gem" };
  let tiles = "";
  for (let i = 0; i < 25; i++) {
    const st = revealed[i] || "";
    const ic = st === "mine" ? icon("bomb") : icon("diamond");
    tiles += `<div class="tile ${st}" data-i="${i}">${ic}</div>`;
  }
  return `<div class="mines-grid">${tiles}</div>`;
}

/* --- DICE : résultat + curseur --- */
function stageDice() {
  return `
  <div class="dice-area">
    <div class="dice-result" id="diceVal">50.50</div>
    <div>
      <div class="slider"><div class="slider__knob"></div></div>
      <div class="scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
    </div>
    <div class="history">
      <b class="win">72.4</b><b>18.9</b><b class="win">55.1</b><b>7.3</b>
      <b class="big">98.7</b><b class="win">61.0</b><b>31.2</b><b class="win">88.4</b>
    </div>
  </div>`;
}

/* --- CRASH : courbe ascendante --- */
function stageCrash() {
  return `
  <div class="crash-area">
    <div class="crash-mult">2.47×</div>
    <div class="crash-chart">
      <svg viewBox="0 0 600 300" preserveAspectRatio="none">
        <defs>
          <linearGradient id="cg" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stop-color="#ffb020"/>
            <stop offset="100%" stop-color="#ff5c00"/>
          </linearGradient>
          <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(255,122,0,.28)"/>
            <stop offset="100%" stop-color="rgba(255,122,0,0)"/>
          </linearGradient>
        </defs>
        <g stroke="rgba(255,255,255,.05)" stroke-width="1">
          <line x1="0" y1="75" x2="600" y2="75"/><line x1="0" y1="150" x2="600" y2="150"/>
          <line x1="0" y1="225" x2="600" y2="225"/>
          <line x1="150" y1="0" x2="150" y2="300"/><line x1="300" y1="0" x2="300" y2="300"/>
          <line x1="450" y1="0" x2="450" y2="300"/>
        </g>
        <path d="M0 300 Q 250 290 400 150 T 560 40 L 560 300 Z" fill="url(#cf)"/>
        <path d="M0 300 Q 250 290 400 150 T 560 40" fill="none" stroke="url(#cg)" stroke-width="4.5" stroke-linecap="round"/>
        <circle cx="560" cy="40" r="8" fill="#ffb020"/>
        <circle cx="560" cy="40" r="14" fill="none" stroke="rgba(255,176,32,.35)" stroke-width="3"/>
      </svg>
    </div>
    <div class="history">
      <b class="big">14.82×</b><b>1.09×</b><b class="win">3.44×</b><b>1.51×</b>
      <b class="win">2.07×</b><b>1.02×</b><b class="big">27.60×</b><b class="win">4.13×</b>
    </div>
  </div>`;
}

/* --- LIMBO : gros multiplicateur --- */
function stageLimbo() {
  return `
  <div class="dice-area">
    <div class="crash-mult" style="font-size:88px">3.72×</div>
    <div class="history">
      <b class="win">2.14×</b><b>1.02×</b><b class="big">18.90×</b><b>1.31×</b>
      <b class="win">5.77×</b><b>1.00×</b><b class="win">2.45×</b><b class="big">44.10×</b>
    </div>
  </div>`;
}

/* --- WHEEL : roue SVG segmentée --- */
function stageWheel() {
  const N = 20;
  const COLORS = ["#ffd21e", "#ff7a00", "#242c40", "#ffb020", "#171c2a"];
  const cx = 100, cy = 100, rOut = 92, rIn = 62;
  let segs = "";
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / N) * 2 * Math.PI - Math.PI / 2;
    const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    segs += `<path d="M ${p(rOut, a0)} A ${rOut} ${rOut} 0 0 1 ${p(rOut, a1)} L ${p(rIn, a1)} A ${rIn} ${rIn} 0 0 0 ${p(rIn, a0)} Z"
      fill="${COLORS[i % COLORS.length]}" stroke="#0d1017" stroke-width="1.5"/>`;
  }
  return `
  <div class="wheel-area">
    <svg class="wheel-svg" viewBox="0 0 200 200">
      ${segs}
      <circle cx="100" cy="100" r="54" fill="#0b0e15" stroke="rgba(255,210,30,.25)" stroke-width="1.5"/>
      <text x="100" y="96" text-anchor="middle" fill="#ffd21e"
        font-family="Bricolage Grotesque, sans-serif" font-size="26" font-weight="800">1.50×</text>
      <text x="100" y="115" text-anchor="middle" fill="#6b74a6"
        font-family="Space Grotesk, sans-serif" font-size="9" font-weight="700" letter-spacing="1">SEGMENT</text>
      <polygon points="100,4 94,18 106,18" fill="#ffd21e"/>
    </svg>
  </div>`;
}

/* ===================================================================
   MONTAGE DE LA PAGE
   =================================================================== */
(function mountGamePage() {
  const g = GAMES[window.GAME];
  if (!g) return;

  /* En-tête */
  document.getElementById("gameHead").innerHTML = `
    <div class="gh__ico">${icon(g.ic)}</div>
    <div>
      <h1 class="gh__title">${g.name}</h1>
      <div class="gh__sub">${g.sub}</div>
    </div>
    <div class="gh__stats">
      ${g.stats.map(([v, k]) => `<div class="gh__stat"><b>${v}</b><span>${k}</span></div>`).join("")}
    </div>`;

  /* Panneau de mise */
  document.getElementById("bet").innerHTML = `
    <div class="bet__tabs">
      <button class="active">Manuel</button>
      <button>Auto</button>
    </div>
    ${g.controls()}
    <div class="payout"><span>${g.payout[0]}</span><b>${g.payout[1]}</b></div>
    <button class="btn btn--orange btn--lg btn--block">${g.action}</button>`;

  /* Scène */
  document.getElementById("stage").innerHTML =
    g.stage() + `<div class="stage__hint">${g.hint}</div>`;

  document.title = `${g.name} — pepe.fail`;

  /* --- Interactions légères (UI seulement) --- */
  document.querySelectorAll("[data-chipgroup]").forEach((grp) => {
    grp.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        grp.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      });
    });
  });

  document.querySelectorAll(".bet__tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".bet__tabs button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    });
  });

  /* Mines : retourner une case au clic */
  document.querySelectorAll(".tile").forEach((t) => {
    t.addEventListener("click", () => {
      if (t.classList.contains("gem") || t.classList.contains("mine")) {
        t.classList.remove("gem", "mine");
      } else {
        t.classList.add("gem");
      }
    });
  });
})();
