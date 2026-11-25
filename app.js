// Navigation et état partagé. Les écrans vivent dans ecran-*.js ;
// la logique métier dans cerveau.js et donnees.js ; le stockage dans stockage.js.
import { normaliser } from "./donnees.js";
import { ouvrir as ouvrirBase, lireEtat, ecrireEtat } from "./stockage.js";
import { initEquipe } from "./ecran-equipe.js";
import { initAppel } from "./ecran-appel.js";
import { initFiche } from "./ecran-fiche.js";
import { initReglages } from "./ecran-reglages.js";

const EMOJI = { neutre: "🙂", joie: "😄", rire: "😂", surprise: "😮", tristesse: "😢", reflexion: "🤔", agacement: "😤" };
const MEMOIRE_PLEINE = "Mémoire du téléphone pleine : efface des conversations.";

const $ = (id) => document.getElementById(id);
let base = null, etat = null;
let actuelId = null;
// Le coach ouvert, relu dans l'état à chaque fois : les objets sont remplacés après ajout, suppression ou import.
const coachDe = (id) => (etat && id && etat.avatars.find((c) => c.id === id)) || null;
const coachCourant = () => coachDe(actuelId);

navigator.storage?.persist?.().catch(() => {});

const initiales = (nom) => nom.split(/\s+/).filter(Boolean).map((m) => m[0]).slice(0, 2).join("").toUpperCase();

let ecranCourant = "chargement", sansConfirmer = false;

function montrer(nom) {
  ecranCourant = nom;
  document.querySelectorAll(".ecran").forEach((e) => e.classList.toggle("actif", e.id === `ecran-${nom}`));
}

// Photo ronde si le coach en a une (data-URL image seulement), sinon pastille de couleur avec initiales.
function pastille(el, a, emotion) {
  el.style.background = a.couleur;
  el.replaceChildren();
  if (typeof a.photo === "string" && a.photo.startsWith("data:image/")) {
    const img = document.createElement("img");
    img.alt = ""; img.src = a.photo;
    el.appendChild(img);
  } else el.textContent = initiales(a.nom);
  if (emotion) {
    const s = document.createElement("span");
    s.className = "emo"; s.title = emotion; s.textContent = EMOJI[emotion] || "";
    el.appendChild(s);
  }
}

let delaiAlerte = 0;
function alerte(texte) {
  $("alerte").textContent = texte;
  $("alerte").hidden = false;
  clearTimeout(delaiAlerte);
  delaiAlerte = setTimeout(() => { $("alerte").hidden = true; }, 6000);
}

// Écrit l'état dans IndexedDB ; si le téléphone refuse, on prévient (l'appli reste utilisable).
async function sauver(silencieux = false) {
  const ok = await ecrireEtat(base, etat);
  if (!ok && !silencieux) alerte(MEMOIRE_PLEINE);
  return ok;
}

// Navigation : chaque écran quitté depuis la liste est une entrée d'historique,
// pour que le bouton retour d'Android revienne en arrière au lieu de fermer l'appli.
function aller(ecran) {
  history.pushState({ ecran }, "");
  afficher(ecran);
}
function afficher(ecran) {
  if (ecran === "chat" && coachCourant()) { appel.afficher(); montrer("chat"); }
  else if (ecran === "fiche" && fiche.ouverte()) montrer("fiche");
  else if (ecran === "reglages") montrer("reglages");
  else { equipe.dessiner(); montrer("liste"); }
}
function retour(sans = false, n = 1) {
  sansConfirmer = sans;
  history.go(-n);
}
window.addEventListener("popstate", (e) => {
  if (!etat) return;
  const cible = e.state?.ecran || "liste";
  const sans = sansConfirmer;
  sansConfirmer = false;
  if (ecranCourant === "fiche" && cible !== "fiche" && !sans && fiche.modifiee() && !confirm("Abandonner les modifications ?")) {
    history.pushState({ ecran: "fiche" }, ""); // on reste sur la fiche
    return;
  }
  afficher(cible);
});

function ouvrirChat(a) {
  if (actuelId !== a.id) $("message").value = ""; // le champ est partagé : on le vide en changeant de coach
  actuelId = a.id;
  aller("chat");
}

const ctx = {
  $, pastille, sauver, aller, retour, alerte,
  get etat() { return etat; },
  get actuelId() { return actuelId; },
  ecran: () => ecranCourant,
  coachCourant,
  coachDe,
  rafraichirFiche: (id) => fiche?.rafraichir(id),
  ouvrirChat,
  ouvrirFiche: (a, origine) => fiche.ouvrir(a, origine),
  apresSuppression(id) {
    appel.apresSuppression(id);
    if (actuelId === id) actuelId = null;
  },
  apresImport(avant) { appel.apresImport(avant); if (!coachCourant()) actuelId = null; },
  apresEffacement() { appel.apresEffacement(); },
};
let equipe, appel, fiche, reglages;

$("retour").onclick = () => retour();
$("vers-fiche").onclick = () => { const c = coachCourant(); if (c) fiche.ouvrir(c, "chat"); };
$("vers-reglages").onclick = () => reglages.ouvrir();
$("bandeau").onclick = () => reglages.ouvrir();

// Démarrage : ouverture de la base (avec migration de l'ancien localStorage), puis écran « Mon équipe ».
(async () => {
  try {
    base = await ouvrirBase();
    etat = normaliser(await lireEtat(base));
  } catch {
    $("chargement-texte").textContent = "Impossible d'ouvrir la mémoire du téléphone. Ferme puis rouvre l'appli.";
    return;
  }
  equipe = initEquipe(ctx);
  appel = initAppel(ctx);
  fiche = initFiche(ctx);
  reglages = initReglages(ctx);
  history.replaceState({ ecran: "liste" }, "");
  afficher("liste");
  window.avatarPret = true; // lu par le minuteur d'index.html
  appel.resumerTout(); // séances restées sans résumé : en arrière-plan, sans bloquer l'écran
})();
