// Écran « Appel » (version texte) : fil de conversation, état du coach, mémoire, fin de séance et résumés.
import { construirePrompt, repondre, resumerMemoire } from "./cerveau.js";
import { ajouterSouvenirs, messagesAResumer, noterSeance, terminerSeance, entreesConservees } from "./donnees.js";
import { micro } from "./voix.js";

const ERREURS = {
  cle_absente: "Ajoute ta clé Gemini dans Réglages.",
  cle_refusee: "Clé refusée par Google : vérifie-la dans Réglages.",
  hors_ligne: "Pas de connexion. Réessaie quand tu as du réseau.",
  sature: "Google est saturé, réessaie dans un instant.",
  quota: "Quota gratuit de Google atteint pour aujourd'hui, réessaie demain.",
};
const ETATS = {
  neutre: "à l'écoute", joie: "sourit", rire: "rit", surprise: "est surpris·e",
  tristesse: "est touché·e", reflexion: "réfléchit", agacement: "fronce les sourcils",
};
const MEMOIRE_PLEINE = "Mémoire du téléphone pleine : efface des conversations.";
const DELAI_RESUME = 40000; // ms
const MAX_MESSAGES = 40; // seuls les derniers messages partent à Gemini ; le fil complet reste stocké
const MICRO = {
  refuse: "Micro indisponible, écris ton message",
  rien: "Je n'ai rien entendu, réessaie.",
  erreur: "La dictée n'a pas marché : réessaie ou écris ton message.",
};

export function initAppel(ctx) {
  const { $ } = ctx;
  const prenomDe = (nom) => nom.split(/\s+/)[0] || nom;
  // Réponse en attente : { id, nom, texte }. L'époque change quand les conversations sont effacées ou les fiches importées.
  let attente = null, epoque = 0, enCours = false;
  const enResume = new Set(); // coachs dont un résumé est en vol : pas de double lancement

  function bulle(role, texte, classe = "") {
    const d = document.createElement("div");
    d.className = `bulle ${role} ${classe}`.trim();
    d.textContent = texte;
    $("fil").appendChild(d);
    $("fil").scrollTop = $("fil").scrollHeight;
    return d;
  }

  function entete() {
    const actuel = ctx.coachCourant();
    if (!actuel) return;
    const conv = ctx.etat.conversations[actuel.id] || [];
    const derniere = [...conv].reverse().find((m) => m.role === "avatar" && m.emotion);
    const emotion = derniere && ETATS[derniere.emotion] ? derniere.emotion : "neutre";
    ctx.pastille($("pastille"), actuel, emotion);
    $("titre").querySelector(".nom").textContent = actuel.nom;
    $("titre").querySelector(".etat").textContent = ETATS[emotion];
    const lignes = String(actuel.memoire?.texte || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(-2);
    $("souvenir").hidden = !lignes.length;
    $("souvenir").textContent = lignes.length ? `${prenomDe(actuel.nom)} se souvient : ${lignes.map((l) => `« ${l} »`).join(" ")}` : "";
  }

  function dessinerFil() {
    const actuel = ctx.coachCourant();
    if (!actuel) return;
    $("fil").replaceChildren();
    for (const m of ctx.etat.conversations[actuel.id] || []) bulle(m.role, m.texte);
    if (attente && attente.id === actuel.id) {
      bulle("user", attente.texte);
      bulle("avatar", `${prenomDe(attente.nom)} écrit…`, "attente");
    }
  }

  function dessinerSaisie() {
    $("envoyer").disabled = enCours;
    const ailleurs = enCours && attente.id !== ctx.actuelId;
    $("message").placeholder = enEcoute ? "Je t'écoute…" : ailleurs ? `Attends la réponse de ${prenomDe(attente.nom)}…` : "Écris un message…";
  }

  // ---------- Dictée au micro ----------
  // Chaque dictée a un numéro : une dictée périmée (message envoyé, autre coach, appli en arrière-plan) est ignorée.
  const dictee = micro();
  let ecoute = 0, enEcoute = false;

  function dessinerMicro() {
    $("micro").setAttribute("aria-pressed", String(enEcoute));
    $("micro").setAttribute("aria-label", enEcoute ? "Arrêter la dictée" : "Dicter un message");
    dessinerSaisie();
  }

  function couperMicro() {
    if (!enEcoute) return;
    ecoute++;
    enEcoute = false;
    dictee.arreter();
    dessinerMicro();
  }

  $("micro").onclick = async () => {
    if (enEcoute) {
      // 2e appui : on garde ce qui a été dit ; si Chrome ne termine jamais, on libère le bouton au bout de 3 s.
      const n = ecoute;
      dictee.arreter();
      setTimeout(() => { if (n === ecoute) couperMicro(); }, 3000);
      return;
    }
    if (!dictee.disponible) { ctx.alerte(MICRO.refuse); return; }
    const mon = ++ecoute, id = ctx.actuelId;
    const avant = $("message").value.trim(); // le texte déjà tapé est gardé devant la dictée
    const joindre = (t) => [avant, t].filter(Boolean).join(" ");
    let ecrit = $("message").value; // dernier texte posé par la dictée : si Nico a tapé depuis, on ne l'écrase pas
    const ecrire = (t) => { if ($("message").value === ecrit) { ecrit = t; $("message").value = t; } };
    // Écran quitté (bouton retour d'Android compris) ou autre coach : la dictée est arrêtée et ignorée.
    const valide = () => {
      if (mon !== ecoute) return false;
      if (ctx.actuelId === id && ctx.ecran() === "chat") return true;
      couperMicro();
      return false;
    };
    enEcoute = true;
    dessinerMicro();
    try {
      const texte = await dictee.ecouter({ surPartiel: (t) => { if (valide()) ecrire(joindre(t)); } });
      if (valide()) ecrire(joindre(texte));
    } catch (e) {
      if (valide()) { ecrire(avant); if (e !== "annule") ctx.alerte(MICRO[e] || MICRO.erreur); }
    } finally {
      if (mon === ecoute) { enEcoute = false; dessinerMicro(); }
    }
  };

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") couperMicro(); });

  function afficher() { couperMicro(); entete(); dessinerFil(); dessinerSaisie(); }
  const redessiner = () => { if (ctx.actuelId) { dessinerFil(); dessinerSaisie(); } };

  // ---------- Résumés de séance ----------

  async function resumer(id) {
    if (enResume.has(id)) return;
    const entree = (ctx.etat.aResumer || []).find((x) => x && x.id === id);
    if (!entree) return;
    const retirer = () => { ctx.etat.aResumer = ctx.etat.aResumer.filter((x) => x !== entree); };
    const vu = (ctx.etat.conversations[id] || []).length; // messages vus par ce résumé
    const coach = ctx.coachDe(id);
    const messages = coach ? messagesAResumer(ctx.etat.conversations[id], entree.depuis) : [];
    if (!messages.length) { retirer(); await ctx.sauver(true); return; } // coach supprimé ou conversation effacée
    enResume.add(id);
    let faits, minuteur;
    try {
      // Une requête qui ne répond jamais ne doit pas bloquer le coach (ni les suivants) : délai maximal.
      const delai = new Promise((r) => { minuteur = setTimeout(() => r(null), DELAI_RESUME); });
      faits = await Promise.race([resumerMemoire({ cle: ctx.etat.reglages.cle, coach, prenom: ctx.etat.reglages.prenom, messages }), delai]);
    } catch { faits = null; } finally { clearTimeout(minuteur); enResume.delete(id); }
    if (!faits) return; // erreur, quota, hors ligne : l'entrée reste pour un prochain essai
    // Tout a pu changer pendant l'attente : on relit le coach et l'entrée par identifiant.
    const cible = ctx.coachDe(id);
    // L'entrée peut avoir été recopiée (coach ajouté ou supprimé) : on la retrouve par identifiant et début.
    const courante = (ctx.etat.aResumer || []).find((x) => x && x.id === id && x.depuis === entree.depuis);
    if (!cible || !courante) return;
    if (faits.length) cible.memoire = ajouterSouvenirs(cible.memoire, faits);
    // Des messages ont pu arriver pendant le résumé : l'entrée est repoussée après ceux qu'il a vus.
    ctx.etat.aResumer = terminerSeance(ctx.etat.aResumer, courante, vu, (ctx.etat.conversations[id] || []).length);
    await ctx.sauver(true);
    if (faits.length) ctx.alerte(`${prenomDe(cible.nom)} a retenu ${faits.length} souvenir${faits.length > 1 ? "s" : ""}`);
    if (ctx.ecran() === "chat" && ctx.actuelId === id) entete();
    ctx.rafraichirFiche(id);
  }

  async function resumerTout() {
    for (const x of [...(ctx.etat.aResumer || [])]) if (x && x.id) await resumer(x.id);
  }

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && ctx.etat) resumerTout(); });

  $("terminer").onclick = () => {
    const id = ctx.actuelId;
    couperMicro();
    ctx.retour();
    if (id) resumer(id); // en arrière-plan : l'interface n'attend pas Gemini
  };

  // ---------- Envoi d'un message ----------

  $("saisie").onsubmit = async (e) => {
    e.preventDefault();
    const etat = ctx.etat;
    const texte = $("message").value.trim();
    if (!texte || enCours) return;
    const a = ctx.coachCourant(), mon = epoque;
    if (!a) return;
    couperMicro(); // la dictée en cours ne doit pas réécrire la saisie après l'envoi
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
    if (mon !== epoque) { redessiner(); return; } // données effacées ou remplacées pendant l'attente : réponse abandonnée
    // Les objets coach ont pu être remplacés pendant l'attente : on n'écrit que dans l'état courant, par identifiant.
    if (!ctx.coachDe(a.id)) { redessiner(); return; }
    let plein = false;
    if (!r.erreur) {
      const avant = etat.conversations[a.id] || [];
      etat.aResumer = noterSeance(etat.aResumer, a.id, avant.length);
      etat.conversations[a.id] = [...avant, { role: "user", texte }, { role: "avatar", texte: r.texte, emotion: r.emotion }];
      plein = !(await ctx.sauver(true));
      if (mon !== epoque) { redessiner(); return; }
    }
    if (ctx.actuelId === a.id) {
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
    if (ctx.actuelId) dessinerSaisie();
  };

  return {
    afficher,
    resumerTout,
    apresSuppression(id) { if (attente?.id === id) epoque++; },
    // Les index « depuis » ne valent plus rien quand les conversations sont remplacées ou effacées.
    apresImport(avant) { epoque++; ctx.etat.aResumer = entreesConservees(ctx.etat.aResumer, avant, ctx.etat.conversations, ctx.etat.avatars); },
    apresEffacement() { epoque++; ctx.etat.aResumer = []; },
  };
}
