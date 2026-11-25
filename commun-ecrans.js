// Éléments partagés par l'écran d'appel et l'écran de conférence : messages d'erreur, états du visage, dictée au micro.
import { micro } from "./voix.js";

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
export function creerDictee({ ctx, champ, bouton, ecran, contexte = () => null, majSaisie = () => {} }) {
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
