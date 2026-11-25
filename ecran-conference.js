// Écran « Conférence » : 2 à 4 coachs discutent avec Nico. Un meneur invisible choisit qui parle (1 ou 2 coachs par tour).
// Les coachs parlent à voix haute (haut-parleur coupable) ; les voix s'enchaînent dans l'ordre des orateurs. Les conférences sont gardées dans etat.conferences et se rouvrent depuis « Mon équipe ».
import { construirePrompt, repondre, choisirOrateurs, detecterDetresse, resumerMemoire } from "./cerveau.js";
import { ajouterSouvenirs, messagesNicoConf, noterResumesConf, terminerResumeConf, entreesConfConservees } from "./donnees.js";
import { ERREURS, ETATS, MEMOIRE_PLEINE, DELAI_RESUME, MAX_MESSAGES, prenomDe, creerDictee, creerVoixEcran } from "./commun-ecrans.js";

const RELANCE = "Continue la conversation.";
const SILENCE = "(Le participant ne dit rien : laisse les coachs réagir entre eux.)";

// Conversation vue par un coach : ses propres tours en « avatar », ceux de Nico en « user », ceux des autres coachs
// injectés dans un tour « user » sous la forme « [Prénom] : texte ». Tours consécutifs de même rôle fusionnés ;
// les 40 derniers messages ; l'échange commence et finit par un tour « user ».
export function historiquePour(fil, coach, coachs) {
  const prenomDeCoach = (id) => prenomDe(coachs.find((c) => c.id === id)?.nom ?? id);
  const tours = [];
  for (const m of fil.slice(-MAX_MESSAGES)) {
    const t = m.role === "user" ? { role: "user", texte: m.texte }
      : m.coach === coach.id ? { role: "avatar", texte: m.texte }
        : { role: "user", texte: `[${prenomDeCoach(m.coach)}] : ${m.texte}` };
    const dernier = tours[tours.length - 1];
    if (dernier && dernier.role === t.role) dernier.texte += `\n${t.texte}`;
    else tours.push(t);
  }
  while (tours.length && tours[0].role !== "user") tours.shift();
  if (!tours.length || tours[tours.length - 1].role !== "user") tours.push({ role: "user", texte: RELANCE });
  return tours;
}

// Un tour de conférence : le meneur choisit les orateurs, qui répondent l'un après l'autre (le 2e voit la réponse du 1er).
// `texteNico` vide = « faire réagir les autres ». Ne modifie pas la conférence : l'appelant range les réponses.
// surOrateurs(coachs) et surReponse(résultat) permettent d'afficher la progression.
export async function tourDeConference({ etat, conference, texteNico = "", fetch = globalThis.fetch, pause, surOrateurs, surReponse }) {
  const coachs = (conference.participants || []).map((id) => etat.avatars.find((a) => a.id === id)).filter(Boolean);
  if (!coachs.length) return [];
  const { cle, prenom } = etat.reglages;
  const texte = String(texteNico).trim();
  const fil = [...(conference.messages || [])];
  if (texte) fil.push({ role: "user", texte });

  let ids;
  if (texte && detecterDetresse(texte)) {
    ids = [(coachs.find((c) => c.id === "gaby") || coachs[0]).id]; // détresse : une seule voix, la plus apte (sans appel au meneur)
  } else {
    // Sans message de Nico, le dernier orateur ne reparle pas si un autre est possible.
    const dernier = texte ? null : [...fil].reverse().find((m) => m.role === "coach")?.coach;
    const possibles = dernier && coachs.length > 1 ? coachs.filter((c) => c.id !== dernier) : coachs;
    const vus = fil.map((m) => (m.role === "user" ? { role: "user", texte: m.texte }
      : { role: "coach", texte: `[${prenomDe(coachs.find((c) => c.id === m.coach)?.nom ?? m.coach)}] : ${m.texte}` }));
    if (!texte) vus.push({ role: "user", texte: SILENCE }); // pour que le meneur ne reprenne pas un coach nommé plus tôt
    ids = await choisirOrateurs({ cle, coachs: possibles, messages: vus, fetch });
  }

  const parlants = ids.map((id) => coachs.find((c) => c.id === id)).filter(Boolean);
  if (surOrateurs) surOrateurs(parlants);
  const resultats = [];
  for (const coach of parlants) {
    const autres = coachs.filter((c) => c.id !== coach.id).map((c) => prenomDe(c.nom));
    const r = await repondre({
      cle,
      systeme: construirePrompt(coach, etat.commun, prenom, { autres }),
      messages: historiquePour(fil, coach, coachs),
      fetch,
      pause,
    });
    const resultat = { coach: coach.id, texte: r.texte, emotion: r.emotion, erreur: r.erreur };
    resultats.push(resultat);
    if (!r.erreur) fil.push({ role: "coach", coach: coach.id, texte: r.texte, emotion: r.emotion });
    if (surReponse) surReponse(resultat);
  }
  return resultats;
}

export function initConference(ctx) {
  const { $ } = ctx;
  // Conférence ouverte : retrouvée par identifiant dans l'état ; tant qu'aucune réponse n'est arrivée, c'est un brouillon (rien de stocké).
  // L'époque change quand les conversations sont effacées ou les fiches importées : les réponses en vol sont alors abandonnées.
  let confId = null, brouillon = null, epoque = 0;
  let enCours = null; // { conf, texte, parlants: [ids], recus: [résultats] } pendant un tour
  let erreurs = []; // résultats en erreur du dernier tour, montrés sur les cartes et dans le fil
  const enResume = new Set(); // « conf|coach » dont un résumé est en vol

  const conf = () => (confId && (ctx.etat.conferences.find((c) => c && c.id === confId) || (brouillon && brouillon.id === confId && brouillon))) || null;
  const coachs = (c) => c.participants.map((id) => ctx.coachDe(id)).filter(Boolean);
  const nouvelId = () => `conf-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const montre = () => ctx.ecran() === "conference";
  const actif = () => (enCours && enCours.conf === confId ? enCours : null);

  // ---------- Dessin ----------

  function bulleCoach(m, classe = "") {
    const a = ctx.coachDe(m.coach);
    const d = document.createElement("div");
    d.className = `bulle avatar ${classe}`.trim();
    if (a) d.style.borderLeft = `4px solid ${a.couleur}`;
    const qui = document.createElement("span");
    qui.className = "qui";
    qui.textContent = a ? prenomDe(a.nom) : m.coach;
    d.append(qui, document.createTextNode(m.texte));
    return d;
  }

  function bulleSimple(role, texte, classe = "") {
    const d = document.createElement("div");
    d.className = `bulle ${role} ${classe}`.trim();
    d.textContent = texte;
    return d;
  }

  function dessinerGrille() {
    const c = conf();
    if (!c) return;
    const cours = actif();
    const courant = cours && cours.parlants.find((id) => !cours.recus.some((r) => r.coach === id));
    $("conf-grille").replaceChildren(...coachs(c).map((a) => {
      const carte = document.createElement("div");
      carte.className = "conf-carte";
      const derniere = [...c.messages].reverse().find((m) => m.role === "coach" && m.coach === a.id && m.emotion);
      const emotion = derniere && ETATS[derniere.emotion] ? derniere.emotion : null;
      const pastille = document.createElement("div");
      pastille.className = "pastille";
      ctx.pastille(pastille, a, emotion, true);
      const texte = document.createElement("div");
      texte.className = "texte";
      const nom = document.createElement("div");
      nom.className = "nom";
      nom.textContent = prenomDe(a.nom);
      const etat = document.createElement("div");
      etat.className = "etat";
      const erreur = erreurs.find((r) => r.coach === a.id);
      if (cours && courant === a.id) { carte.classList.add("parle"); etat.textContent = "écrit…"; }
      else if (erreur) { carte.classList.add("erreur"); etat.textContent = ERREURS[erreur.erreur] || "Une erreur est survenue."; }
      else if (prepare.has(a.id)) etat.textContent = "prépare sa voix…";
      else etat.textContent = ETATS[emotion || "neutre"];
      texte.append(nom, etat);
      carte.append(pastille, texte);
      return carte;
    }));
  }

  function dessinerFil() {
    const c = conf();
    if (!c) return;
    const fil = $("conf-fil");
    const bas = fil.scrollTop + fil.clientHeight >= fil.scrollHeight - 40; // on ne tire pas Nico vers le bas s'il relit plus haut
    fil.replaceChildren();
    for (const m of c.messages) fil.appendChild(m.role === "user" ? bulleSimple("user", m.texte) : bulleCoach(m));
    const cours = actif();
    if (cours) {
      if (cours.texte) fil.appendChild(bulleSimple("user", cours.texte));
      for (const r of cours.recus) fil.appendChild(r.erreur ? bulleErreur(r) : bulleCoach(r));
      const courant = cours.parlants.find((id) => !cours.recus.some((r) => r.coach === id));
      const a = courant && ctx.coachDe(courant);
      fil.appendChild(bulleSimple("avatar", a ? `${prenomDe(a.nom)} écrit…` : "Les coachs réfléchissent…", "attente"));
    } else {
      for (const r of erreurs) fil.appendChild(bulleErreur(r));
    }
    if (bas || cours) fil.scrollTop = fil.scrollHeight;
  }

  function bulleErreur(r) {
    const a = ctx.coachDe(r.coach);
    const nom = a ? prenomDe(a.nom) : r.coach;
    return bulleSimple("avatar", `${nom} : ${ERREURS[r.erreur] || "Une erreur est survenue."}`, "erreur");
  }

  function dessinerSaisie() {
    const c = conf();
    const occupe = !!enCours;
    $("conf-envoyer").disabled = occupe;
    $("conf-reagir").disabled = occupe || !c || !c.messages.some((m) => m.role === "coach");
    $("conf-terminer").disabled = occupe;
    $("conf-message").placeholder = dictee.enEcoute() ? "Je t'écoute…"
      : occupe ? "Les coachs répondent…"
        : c && c.messages.length ? "Écris un message…" : "Sur quoi veux-tu discuter ?";
  }

  const dessiner = () => { dessinerGrille(); dessinerFil(); dessinerSaisie(); };
  const redessiner = () => { if (montre() && conf()) dessiner(); };

  // ---------- Voix des orateurs ----------
  // Pendant la synthèse, « prépare sa voix… » remplace l'état du coach sur sa carte.
  const prepare = new Set();
  const voix = creerVoixEcran({
    ctx, bouton: $("conf-voix"), indicateur: $("conf-voix-secours"), ecran: "conference", contexte: () => confId, ecoute: () => dictee.enEcoute(),
    surPrepare: (cle, v) => {
      if (cle === null) prepare.clear(); else if (v) prepare.add(cle); else prepare.delete(cle);
      if (montre() && conf()) dessinerGrille();
    },
  });

  // ---------- Dictée au micro ----------
  const dictee = creerDictee({
    ctx, champ: $("conf-message"), bouton: $("conf-micro"), ecran: "conference", contexte: () => confId, majSaisie: dessinerSaisie,
    avantEcoute: () => { voix.arreter(); voix.deverrouiller(); },
  });

  // ---------- Un tour ----------

  async function lancer(texte) {
    const c = conf();
    if (!c || enCours) return;
    const mon = epoque, id = c.id;
    dictee.couper(); // la dictée en cours ne doit pas réécrire la saisie après l'envoi
    voix.arreter(); // Nico reprend la parole : les coachs se taisent
    voix.deverrouiller(); // geste de Nico : l'audio pourra démarrer après l'attente de Gemini
    erreurs = [];
    enCours = { conf: id, texte, parlants: [], recus: [] };
    const cours = enCours;
    if (texte) $("conf-message").value = "";
    dessiner();
    let resultats;
    try {
      resultats = await tourDeConference({
        etat: ctx.etat,
        conference: c,
        texteNico: texte,
        surOrateurs: (parlants) => { if (mon === epoque) { cours.parlants = parlants.map((a) => a.id); redessiner(); } },
        surReponse: (r) => {
          if (mon !== epoque) return;
          cours.recus.push(r);
          if (!r.erreur && confId === id) voix.lire({ texte: r.texte, emotion: r.emotion, voix: ctx.coachDe(r.coach)?.voix, cle: r.coach }); // texte déjà affiché ; synthèse tout de suite, lecture dans l'ordre
          if (r.erreur && confId === id) erreurs.push(r);
          redessiner();
        },
      });
    } catch { resultats = []; }
    enCours = null;
    if (mon !== epoque) { redessiner(); return; } // données effacées ou remplacées pendant l'attente : réponses abandonnées
    // Seules les réponses réussies de coachs encore présents sont gardées ; les erreurs restent sur les cartes.
    const bons = resultats.filter((r) => !r.erreur && ctx.coachDe(r.coach));
    let plein = false;
    if (!resultats.length) ctx.alerte("Aucun coach de cette conférence n'est encore dans ton équipe.");
    if (bons.length) {
      let stock = ctx.etat.conferences.find((x) => x && x.id === id);
      if (!stock) { stock = c; ctx.etat.conferences.push(stock); if (brouillon && brouillon.id === id) brouillon = null; }
      if (texte) stock.messages.push({ role: "user", texte });
      for (const r of bons) stock.messages.push({ role: "coach", coach: r.coach, texte: r.texte, emotion: r.emotion });
      plein = !(await ctx.sauver(true));
      if (mon !== epoque) { redessiner(); return; }
    } else if (texte && confId === id && !$("conf-message").value) {
      $("conf-message").value = texte; // aucune réponse : le message de Nico n'est pas gardé, on le lui rend
    }
    if (montre()) { // libère aussi l'état « en cours » sur l'écran affiché, quelle que soit sa conférence
      dessiner();
      if (plein && confId === id) $("conf-fil").appendChild(bulleSimple("avatar", MEMOIRE_PLEINE, "erreur"));
    }
  }

  $("conf-saisie").onsubmit = (e) => {
    e.preventDefault();
    const texte = $("conf-message").value.trim();
    if (texte) lancer(texte);
  };
  $("conf-reagir").onclick = () => lancer("");
  $("conf-retour").onclick = () => { dictee.couper(); voix.arreter(); ctx.retour(); };

  // ---------- Résumés de mémoire ----------

  // Retourne { prenom, n } si un résumé a été rangé, sinon null (entrée gardée pour un prochain essai, ou retirée si sans objet).
  async function resumer(entree) {
    const cle = `${entree.conf}|${entree.coach}`;
    if (enResume.has(cle)) return null;
    const retirer = () => { ctx.etat.aResumerConf = terminerResumeConf(ctx.etat.aResumerConf, entree, 0, 0); };
    const c = ctx.etat.conferences.find((x) => x && x.id === entree.conf);
    const coach = ctx.coachDe(entree.coach);
    const messages = c && coach ? messagesNicoConf(c, entree.depuis) : [];
    if (!messages.length) { retirer(); await ctx.sauver(true); return null; } // conférence ou coach supprimé, rien à résumer
    const vu = c.messages.length; // messages vus par ce résumé
    enResume.add(cle);
    let faits, minuteur;
    try {
      const delai = new Promise((r) => { minuteur = setTimeout(() => r(null), DELAI_RESUME); });
      faits = await Promise.race([resumerMemoire({ cle: ctx.etat.reglages.cle, coach, prenom: ctx.etat.reglages.prenom, messages }), delai]);
    } catch { faits = null; } finally { clearTimeout(minuteur); enResume.delete(cle); }
    if (!faits) return null; // erreur, quota, hors ligne : l'entrée reste, retentée au lancement suivant
    // Tout a pu changer pendant l'attente : on relit le coach et l'entrée.
    const cible = ctx.coachDe(entree.coach);
    const courante = (ctx.etat.aResumerConf || []).find((x) => x.conf === entree.conf && x.coach === entree.coach && x.depuis === entree.depuis);
    if (!cible || !courante) return null;
    if (faits.length) cible.memoire = ajouterSouvenirs(cible.memoire, faits);
    // Des messages ont pu arriver pendant le résumé (nouveau « Terminer » sans effet tant qu'il tournait) : l'entrée avance au lieu de disparaître.
    const longueur = (ctx.etat.conferences.find((x) => x && x.id === entree.conf)?.messages || []).length;
    ctx.etat.aResumerConf = terminerResumeConf(ctx.etat.aResumerConf, courante, vu, longueur);
    await ctx.sauver(true);
    ctx.rafraichirFiche(cible.id);
    return faits.length ? { prenom: prenomDe(cible.nom), n: faits.length } : null;
  }

  async function resumerTout() {
    const retenus = [];
    // Une entrée qui avance (messages arrivés pendant son résumé) est reprise dans la foulée ; chaque état d'entrée n'est tenté qu'une fois.
    const essayes = new Set();
    const cle = (x) => `${x.conf}|${x.coach}|${x.depuis}`;
    for (let suite = (ctx.etat.aResumerConf || []).find((x) => !essayes.has(cle(x))); suite; suite = (ctx.etat.aResumerConf || []).find((x) => !essayes.has(cle(x)))) {
      essayes.add(cle(suite));
      const r = await resumer(suite);
      if (r) retenus.push(r);
    }
    if (retenus.length) ctx.alerte(`${retenus.map((r) => r.prenom).join(", ")} ${retenus.length > 1 ? "ont" : "a"} retenu de nouveaux souvenirs`);
  }

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && ctx.etat) resumerTout(); });

  $("conf-terminer").onclick = async () => {
    dictee.couper(); voix.arreter();
    const c = conf();
    ctx.retour();
    if (!c || !ctx.etat.conferences.includes(c)) return; // brouillon sans réponse : rien à garder
    ctx.etat.aResumerConf = noterResumesConf(ctx.etat.aResumerConf, c);
    c.resume = c.messages.length;
    await ctx.sauver(true);
    resumerTout(); // en arrière-plan : l'interface n'attend pas Gemini
  };

  // ---------- Ouverture ----------

  function ouvrirEcran() {
    erreurs = [];
    $("conf-message").value = "";
    ctx.aller("conference");
  }

  return {
    // Nouvelle conférence entre ces coachs (identifiants dans l'ordre de l'équipe).
    ouvrir(participants) {
      brouillon = { id: nouvelId(), date: new Date().toISOString(), participants: [...participants], messages: [] };
      confId = brouillon.id;
      ouvrirEcran();
    },
    // Conférence passée, rouverte pour continuer.
    rouvrir(c) {
      brouillon = null;
      confId = c.id;
      ouvrirEcran();
    },
    ouverte: () => !!conf(),
    afficher() { dictee.couper(); voix.arreter(); voix.dessiner(); dessiner(); },
    resumerTout,
    // Les conférences sont effacées avec les conversations ; les résumés en attente n'ont plus d'objet.
    apresEffacement() {
      epoque++; voix.arreter();
      ctx.etat.conferences = [];
      ctx.etat.aResumerConf = [];
      brouillon = null; confId = null; erreurs = [];
    },
    // Après un import : les conférences ont pu être remplacées ; on garde seulement les résumés dont la conférence et le coach existent.
    apresImport(avantConferences) {
      epoque++; voix.arreter();
      const e = ctx.etat;
      e.aResumerConf = entreesConfConservees(e.aResumerConf, avantConferences, e.conferences, e.avatars);
      brouillon = null; confId = null; erreurs = [];
    },
  };
}
