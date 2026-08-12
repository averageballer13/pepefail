/* ===================================================================
   pepe.fail — casino home page
   =================================================================== */

hydrateIcons();
bindScrollers();

/* Hero card icons */
const hcCasino = document.getElementById("hcCasino");
const hcLive = document.getElementById("hcLive");
if (hcCasino) hcCasino.insertAdjacentHTML("afterbegin", icon("chip", 1.9));
if (hcLive) hcLive.insertAdjacentHTML("afterbegin", icon("cards", 1.9));

/* Carousels */
fillRow("originals", ORIGINALS);
fillRow("slots", SLOTS);
fillRow("live", LIVE_GAMES);

/* ===================================================================
   Wallet entry points
   =================================================================== */

/* Starts the wallet creation flow when wallet.js is loaded. */
function startWallet() {
  if (window.PepeWallet && typeof window.PepeWallet.startCreateFlow === "function") {
    window.PepeWallet.startCreateFlow();
    return true;
  }
  return false;
}

/* Sign-up style buttons: explain the mockup, then offer the wallet flow. */
function openSignupModal() {
  if (!window.PepeModal || typeof window.PepeModal.open !== "function") {
    startWallet();
    return;
  }
  window.PepeModal.open({
    title: "Join pepe.fail",
    subtitle: "No email, no password — just a wallet.",
    size: "sm",
    trust: true,
    body:
      '<p style="color:var(--text-dim);font-size:14px;line-height:1.6;margin:0">' +
      "This site is a demonstration mockup. Nothing here uses real money. " +
      "Create a demo wallet to keep your balance and history on this device." +
      "</p>",
    actions: [
      {
        label: "Create Wallet",
        variant: "gold",
        onClick: function () {
          window.PepeModal.close();
          startWallet();
        },
      },
      {
        label: "Not now",
        variant: "glass",
        onClick: function () {
          window.PepeModal.close();
        },
      },
    ],
  });
}

const heroWallet = document.getElementById("heroWallet");
if (heroWallet) heroWallet.addEventListener("click", startWallet);

document.querySelectorAll("[data-signup]").forEach(function (btn) {
  btn.addEventListener("click", openSignupModal);
});
