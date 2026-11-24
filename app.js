// Écrans et événements de l'appli. La logique métier vit dans cerveau.js et donnees.js.
import { construirePrompt, repondre } from "./cerveau.js";
import { charger, sauver, exporter, importer } from "./donnees.js";

const EMOJI = { neutre: "🙂", joie: "😄", rire: "😂", surprise: "😮", tristesse: "😢", reflexion: "🤔", agacement: "😤" };
const ERREURS = {
  cle_absente: "Ajoute ta clé Gemini dans Réglages.",
  cle_refusee: "Clé refusée par Google : vérifie-la dans Réglages.",
  hors_ligne: "Pas de connexion. Réessaie quand tu as du réseau.",
  sature: "Google est saturé, réessaie dans un instant.",
  quota: "Quota gratuit de Google atteint pour aujourd'hui, réessaie demain.",
};
const MEMOIRE_PLEINE = "Mémoire du téléphone pleine : efface les conversations.";
const MAX_MESSAGES = 40; // seuls les derniers messages partent à Gemini ; le fil complet reste stocké

const $ = (id) => document.getElementById(id);
const etat = charger();
let actuel = null, enCours = false;

navigator.storage?.persist?.().catch(() => {});

const initiales = (nom) => nom.split(/\s+/).filter(Boolean).map((m) => m[0]).slice(0, 2).join("").toUpperCase();

let ecranCourant = "liste", sansConfirmer = false;

function montrer(nom) {
  ecranCourant = nom;
  document.querySelectorAll(".ecran").forEach((e) => e.classList.toggle("actif", e.id === `ecran-${nom}`));
}

function pastille(el, a, emotion) {
  el.style.background = a.couleur;
  el.textContent = initiales(a.nom);
  if (emotion) {
    const s = document.createElement("span");
    s.className = "emo"; s.title = emotion; s.textContent = EMOJI[emotion] || "";
    el.appendChild(s);
  }
}

function dessinerListe() {
  $("bandeau").hidden = !!etat.reglages.cle;
  $("liste").replaceChildren(...etat.avatars.map((a) => {
    const b = document.createElement("button");
    b.className = "carte";
    b.innerHTML = `<div class="pastille"></div><div><div class="nom"></div><div class="lien"></div></div>`;
    pastille(b.querySelector(".pastille"), a);
    b.querySelector(".nom").textContent = a.nom;
    b.querySelector(".lien").textContent = a.lien;
    b.onclick = () => ouvrir(a);
    return b;
  }));
}

function bulle(role, texte, classe = "") {
  const d = document.createElement("div");
  d.className = `bulle ${role} ${classe}`.trim();
  d.textContent = texte;
  $("fil").appendChild(d);
  $("fil").scrollTop = $("fil").scrollHeight;
  return d;
}

function entete() {
  const conv = etat.conversations[actuel.id] || [];
  const derniere = [...conv].reverse().find((m) => m.role === "avatar" && m.emotion);
  pastille($("pastille"), actuel, derniere?.emotion || "neutre");
  $("titre").querySelector(".nom").textContent = actuel.nom;
  $("titre").querySelector(".etat").textContent = actuel.lien;
}

// Réponse en attente : { id, nom, texte }. L'époque change quand les conversations sont effacées ou les fiches importées.
let attente = null, epoque = 0;

function dessinerFil() {
  $("fil").replaceChildren();
  for (const m of etat.conversations[actuel.id] || []) bulle(m.role, m.texte);
  if (attente && attente.id === actuel.id) {
    bulle("user", attente.texte);
    bulle("avatar", `${attente.nom.split(" ")[0]} écrit…`, "attente");
  }
}

function dessinerSaisie() {
  $("envoyer").disabled = enCours;
  const ailleurs = enCours && attente.id !== actuel?.id;
  $("message").placeholder = ailleurs ? `Attends la réponse de ${attente.nom.split(" ")[0]}…` : "Écris un message…";
}

// Navigation : chaque écran quitté depuis la liste est une entrée d'historique,
// pour que le bouton retour d'Android revienne en arrière au lieu de fermer l'appli.
history.replaceState({ ecran: "liste" }, "");
function aller(ecran) {
  history.pushState({ ecran }, "");
  afficher(ecran);
}
function afficher(ecran) {
  if (ecran === "chat" && actuel) montrer("chat");
  else if (ecran === "fiche" && actuel) montrer("fiche");
  else if (ecran === "reglages") montrer("reglages");
  else { dessinerListe(); montrer("liste"); }
}
const ficheModifiee = () => actuel && ($("f-nom").value !== actuel.nom || $("f-lien").value !== actuel.lien || $("f-fiche").value !== actuel.fiche);
function retour(sans = false) {
  sansConfirmer = sans;
  history.back();
}
window.addEventListener("popstate", (e) => {
  const cible = e.state?.ecran || "liste";
  const sans = sansConfirmer;
  sansConfirmer = false;
  if (ecranCourant === "fiche" && cible !== "fiche" && !sans && ficheModifiee() && !confirm("Abandonner les modifications ?")) {
    history.pushState({ ecran: "fiche" }, ""); // on reste sur la fiche
    return;
  }
  afficher(cible);
});

function ouvrir(a) {
  if (actuel?.id !== a.id) $("message").value = ""; // le champ est partagé : on le vide en changeant d'avatar
  actuel = a;
  entete();
  dessinerFil();
  dessinerSaisie();
  aller("chat");
}

$("retour").onclick = () => retour();

$("saisie").onsubmit = async (e) => {
  e.preventDefault();
  const texte = $("message").value.trim();
  if (!texte || enCours) return;
  const a = actuel, mon = epoque;
  const messages = [...(etat.conversations[a.id] || []), { role: "user", texte }].map(({ role, texte }) => ({ role, texte })).slice(-MAX_MESSAGES);
  while (messages[0].role !== "user") messages.shift(); // l'échange commence toujours par Nico
  enCours = true;
  attente = { id: a.id, nom: a.nom, texte };
  $("message").value = "";
  dessinerFil();
  dessinerSaisie();
  const r = await repondre({
    cle: etat.reglages.cle,
    systeme: construirePrompt(a, etat.commun, etat.reglages.prenom),
    messages,
  });
  enCours = false;
  attente = null;
  if (mon !== epoque) { // données effacées ou remplacées pendant l'attente : la réponse est abandonnée
    if (actuel) { dessinerFil(); dessinerSaisie(); }
    return;
  }
let plein = false;
  if (!r.erreur) {
    etat.conversations[a.id] = [...(etat.conversations[a.id] || []), { role: "user", texte }, { role: "avatar", texte: r.texte, emotion: r.emotion }];
    plein = !sauver(etat);
  }
  if (actuel === a) {
    dessinerFil();
    if (plein) {
      entete();
      bulle("avatar", MEMOIRE_PLEINE, "erreur");
    } else if (r.erreur) {
      // Le message de Nico n'est gardé que si une réponse arrive : on le remet dans la saisie s'il n'a rien écrit d'autre.
      if (!$("message").value) $("message").value = texte;
      bulle("avatar", ERREURS[r.erreur] || "Une erreur est survenue.", "erreur");
    } else entete();
  }
  if (actuel) dessinerSaisie();
};

// Fiche
$("vers-fiche").onclick = () => {
  $("f-nom").value = actuel.nom;
  $("f-lien").value = actuel.lien;
  $("f-fiche").value = actuel.fiche;
  aller("fiche");
};
$("fiche-annuler").onclick = () => retour(true);
$("fiche-ok").onclick = () => {
  actuel.nom = $("f-nom").value.trim() || actuel.nom;
  actuel.lien = $("f-lien").value.trim();
  actuel.fiche = $("f-fiche").value;
  sauver(etat);
  entete();
  retour(true);
};

// Réglages
function ouvrirReglages() {
  $("r-cle").value = etat.reglages.cle;
  $("r-prenom").value = etat.reglages.prenom;
  $("r-commun").value = etat.commun;
  $("r-msg").textContent = "";
  aller("reglages");
}
$("vers-reglages").onclick = ouvrirReglages;
$("bandeau").onclick = ouvrirReglages;
$("reglages-annuler").onclick = () => retour();
$("reglages-ok").onclick = () => {
  etat.reglages.cle = $("r-cle").value.trim();
  etat.reglages.prenom = $("r-prenom").value.trim() || "Nico";
  etat.commun = $("r-commun").value;
  sauver(etat);
  retour();
};

$("exporter").onclick = () => {
  const nom = `avatar-fiches-${new Date().toLocaleDateString("sv-SE")}.json`; // AAAA-MM-JJ, date locale
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(new Blob([exporter(etat)], { type: "application/json" }));
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
  $("r-msg").textContent = `Fichier ${nom} créé.`;
};

$("importer").onclick = () => $("fichier").click();
$("fichier").onchange = async () => {
  const f = $("fichier").files[0];
  $("fichier").value = "";
  if (!f) return;
  let contenu;
  try { contenu = await f.text(); } catch { $("r-msg").textContent = "Impossible de lire le fichier."; return; }
  const res = importer(etat, contenu);
  if (!res.ok) { $("r-msg").textContent = res.erreur; return; }
  Object.assign(etat, res.etat);
  epoque++;
  actuel = null;
  sauver(etat);
  $("r-commun").value = etat.commun;
  $("r-msg").textContent = "Fiches importées.";
};

$("effacer").onclick = () => {
  if (!confirm("Effacer toutes les conversations ? Les fiches sont gardées.")) return;
  etat.conversations = {};
  epoque++;
  sauver(etat);
  $("r-msg").textContent = "Conversations effacées.";
};

dessinerListe();
