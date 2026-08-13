/* ===================================================================
   pepe.fail — casino home page
   =================================================================== */

hydrateIcons();
bindScrollers();

/* Carousels */
fillRow("originals", ORIGINALS);

/* ===================================================================
   Wallet entry points

   The page must never tell someone who already has a wallet to create
   one: every button and hint below reflects the actual wallet state,
   and re-reflects it whenever that state changes.
   =================================================================== */

function walletExists() {
  try {
    return !!(window.PepeWallet && window.PepeWallet.exists && window.PepeWallet.exists());
  } catch (e) {
    return false;
  }
}

/* Create when there is nothing, open when there is. */
function walletAction() {
  if (!window.PepeWallet) return;
  if (walletExists() && window.PepeWalletPanel) {
    window.PepeWalletPanel.open("deposit");
  } else {
    window.PepeWallet.startCreateFlow();
  }
}

function reflectWallet() {
  const exists = walletExists();

  const hero = document.getElementById("heroWallet");
  if (hero) hero.textContent = exists ? "Open Wallet" : "Create Wallet";

  const cta = document.getElementById("ctaWallet");
  if (cta) cta.textContent = exists ? "Open Wallet" : "Create Wallet";

  const t = document.querySelector(".cta-strip__t");
  const s = document.querySelector(".cta-strip__s");
  if (t) t.textContent = exists ? "Welcome back" : "Join the golden Frog horde";
  if (s) s.textContent = exists
    ? "Your wallet lives on this device — open it and keep playing."
    : "Create a wallet and start playing.";
}

["heroWallet", "ctaWallet"].forEach(function (id) {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", walletAction);
});

reflectWallet();
document.addEventListener("pepe:wallet", reflectWallet);
