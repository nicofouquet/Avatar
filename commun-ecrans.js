// Éléments partagés par l'écran d'appel et l'écran de conférence : messages d'erreur, états du visage, dictée au micro.
import { micro, synthetiser, jouer, parlerNavigateur, arreterVoix, deverrouiller } from "./voix.js";

export const ERREURS = {
  cle_absente: "Ajoute ta clé Gemini dans Réglages.",
  cle_refusee: "Clé refusée par Google : vérifie-la dans Réglages.",
  hors_ligne: "Pas de connexion. Réessaie quand tu as du réseau.",
  sature: "Google est saturé, réessaie dans un instant.",
  quota: "Quota gratuit de Google atteint pour aujourd'hui, réessaie demain.",
};
export const ETATS = {
  neutre: "à l'écoute", joie: "sourit", rire: "rit", surprise: "est surpris·e",
  tristesse: "est touché·e", reflexion: "réfléchit", agacement: "fronce les sourcils",
};
export const MEMOIRE_PLEINE = "Mémoire du téléphone pleine : efface des conversations.";
export const DELAI_RESUME = 40000; // ms : une requête de résumé qui ne répond jamais ne bloque rien
export const MAX_MESSAGES = 40; // seuls les derniers messages partent à Gemini ; le fil complet reste stocké
// Après un résumé raté (quota, réseau), pas d'autre tentative avant un moment : évite de multiplier les requêtes refusées.
// Partagé par l'appel et la conférence ; les entrées restent en attente (reprises au lancement suivant ou après la pause).
export const PAUSE_RESUME = 10 * 60 * 1000;
let pasDeResumeAvant = 0;
export const resumesEnPause = (maintenant = Date.now()) => maintenant < pasDeResumeAvant;
export const pauserResumes = (maintenant = Date.now(), duree = PAUSE_RESUME) => { pasDeResumeAvant = maintenant + duree; };
export const reprendreResumes = () => { pasDeResumeAvant = 0; };
export const prenomDe = (nom) => String(nom).split(/\s+/)[0] || String(nom);

const MICRO = {
  refuse: "Micro indisponible, écris ton message",
  rien: "Je n'ai rien entendu, réessaie.",
  erreur: "La dictée n'a pas marché : réessaie ou écris ton message.",
};

// Dictée au micro dans un champ de saisie. Chaque dictée a un numéro : une dictée périmée
// (message envoyé, autre coach ou conférence, écran quitté, appli en arrière-plan) est ignorée.
//  - champ, bouton : éléments du formulaire ; ecran : nom de l'écran où la dictée est valable ;
//  - contexte() : valeur qui change quand on passe à un autre coach ou une autre conférence ;
//  - majSaisie() : appelé quand l'état d'écoute change (pour redessiner placeholder et boutons).
export function creerDictee({ ctx, champ, bouton, ecran, contexte = () => null, majSaisie = () => {}, avantEcoute = () => {} }) {
  const dictee = micro();
  let ecoute = 0, enEcoute = false;

  function dessiner() {
    bouton.setAttribute("aria-pressed", String(enEcoute));
    bouton.setAttribute("aria-label", enEcoute ? "Arrêter la dictée" : "Dicter un message");
    majSaisie();
  }

  function couper() {
    if (!enEcoute) return;
    ecoute++;
    enEcoute = false;
    dictee.arreter();
    dessiner();
  }

  bouton.onclick = async () => {
    avantEcoute(); // geste de Nico : coupe la voix des coachs et débloque l'audio
    if (enEcoute) {
      // 2e appui : on garde ce qui a été dit ; si Chrome ne termine jamais, on libère le bouton au bout de 3 s.
      const n = ecoute;
      dictee.arreter();
      setTimeout(() => { if (n === ecoute) couper(); }, 3000);
      return;
    }
    if (!dictee.disponible) { ctx.alerte(MICRO.refuse); return; }
    const mon = ++ecoute, id = contexte();
    const avant = champ.value.trim(); // le texte déjà tapé est gardé devant la dictée
    const joindre = (t) => [avant, t].filter(Boolean).join(" ");
    let ecrit = champ.value; // dernier texte posé par la dictée : si Nico a tapé depuis, on ne l'écrase pas
    const ecrire = (t) => { if (champ.value === ecrit) { ecrit = t; champ.value = t; } };
    // Écran quitté (bouton retour d'Android compris) ou autre contexte : la dictée est arrêtée et ignorée.
    const valide = () => {
      if (mon !== ecoute) return false;
      if (contexte() === id && ctx.ecran() === ecran) return true;
      couper();
      return false;
    };
    enEcoute = true;
    dessiner();
    try {
      const texte = await dictee.ecouter({ surPartiel: (t) => { if (valide()) ecrire(joindre(t)); } });
      if (valide()) ecrire(joindre(texte));
    } catch (e) {
      if (valide()) { ecrire(avant); if (e !== "annule") ctx.alerte(MICRO[e] || MICRO.erreur); }
    } finally {
      if (mon === ecoute) { enEcoute = false; dessiner(); }
    }
  };

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") couper(); });

  return { couper, enEcoute: () => enEcoute };
}

// ---------- Voix des coachs ----------

// File de lecture : la synthèse d'une réponse démarre dès qu'elle est confiée à lire() (en parallèle des autres),
// mais la lecture se fait dans l'ordre d'arrivée. Un échec de voix ne produit jamais d'erreur à l'écran :
// voix de secours du téléphone, ou silence. arreter() annule tout (synthèses en vol comprises).
//  - synthetiser({texte, voix, emotion}) -> {audio, erreur}, jouer(blob) -> "fini"|"arrete"|"refuse", parler(texte, {voix}), arreter() ;
//  - surSecours(bool) : la voix du téléphone est (ou n'est plus) utilisée ; surPrepare(cle, bool) : la voix de ce coach se prépare.
export function creerFileVoix({ synthetiser, jouer, parler, arreter, surSecours = () => {}, surPrepare = () => {} }) {
  let generation = 0, chaine = Promise.resolve(), abandon = new AbortController();
  function lire({ texte, emotion, voix, cle = null, valide = () => true }) {
    const gen = generation, signal = abandon.signal;
    const vivant = () => gen === generation && valide();
    surPrepare(cle, true);
    const fini = () => { if (gen === generation) surPrepare(cle, false); };
    const synthese = Promise.resolve()
      .then(() => (vivant() ? synthetiser({ texte, voix, emotion, signal }) : null))
      .catch(() => ({ audio: null, erreur: "erreur" }));
    chaine = chaine.then(async () => {
      const r = await synthese;
      if (!r || !vivant()) return;
      if (r.audio) {
        fini();
        const issue = await jouer(r.audio);
        if (issue !== "refuse") { if (vivant()) surSecours(false); return; } // lu, ou interrompu
      } else if (r.erreur === "cle_absente") { fini(); return; }
      fini();
      if (!vivant()) return;
      surSecours(true);
      await parler(texte, { voix });
    }).catch(() => {}).then(fini);
  }
  function couper() { generation++; abandon.abort(); abandon = new AbortController(); chaine = Promise.resolve(); surPrepare(null, false); arreter(); }
  return { lire, arreter: couper };
}

// Haut-parleur d'un écran : bouton (aria-pressed), indicateur « voix de secours », file de lecture liée à l'écran.
//  - ecran : nom de l'écran où la voix est valable ; contexte() : change quand on passe à un autre coach ou une autre conférence ;
//  - ecoute() : vrai pendant la dictée (la voix des coachs ne démarre alors pas : elle serait dictée dans le message) ;
//  - surPrepare(cle, bool) : pour afficher « prépare sa voix… ».
// La lecture s'arrête quand l'écran est quitté (retour d'Android compris) ou que l'appli passe en arrière-plan.
export function creerVoixEcran({ ctx, bouton, indicateur, ecran, contexte = () => null, ecoute = () => false, surPrepare = () => {}, moteur = {} }) {
  const m = { synthetiser, jouer, parlerNavigateur, arreterVoix, deverrouiller, ...moteur };
  const actif = () => ctx.etat?.reglages?.voixActive !== false;
  const file = creerFileVoix({
    synthetiser: ({ texte, voix, emotion, signal }) => m.synthetiser({ cle: ctx.etat.reglages.cle, texte, voix, emotion, signal }),
    jouer: (a) => m.jouer(a),
    parler: (t, o) => m.parlerNavigateur(t, o),
    arreter: () => m.arreterVoix(),
    surSecours: (v) => { indicateur.hidden = !v; },
    surPrepare,
  });

  function dessiner() {
    const on = actif();
    bouton.setAttribute("aria-pressed", String(on));
    bouton.setAttribute("aria-label", on ? "Couper la voix" : "Activer la voix");
    bouton.textContent = on ? "🔊" : "🔇";
    if (!on) indicateur.hidden = true;
  }
  const arreter = () => file.arreter();

  bouton.onclick = () => {
    m.deverrouiller();
    ctx.etat.reglages.voixActive = !actif();
    if (!actif()) arreter();
    dessiner();
    ctx.sauver(true);
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") arreter(); });
  ctx.surEcran?.((nom) => { if (nom !== ecran) arreter(); });
  dessiner();

  return {
    dessiner,
    arreter,
    deverrouiller: () => m.deverrouiller(),
    // Lit une réponse (si la voix est active) ; abandonnée si Nico a changé de coach, de conférence ou d'écran entre-temps.
    lire({ texte, emotion, voix, cle }) {
      if (!actif() || !texte) return;
      const id = contexte();
      file.lire({ texte, emotion, voix, cle, valide: () => ctx.ecran() === ecran && contexte() === id && !ecoute() });
    },
  };
}
