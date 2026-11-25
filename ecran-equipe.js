// Écran « Mon équipe » : une carte par coach (case à cocher, photo, nom, rôle), ajout, Appeler.
import { ajouterCoach } from "./donnees.js";

export function initEquipe(ctx) {
  const { $ } = ctx;
  const coches = new Set();

  function majBoutons() {
    $("appeler").disabled = coches.size !== 1;
    $("conference").disabled = coches.size < 2 || coches.size > 4;
  }

  // Conférences passées, la plus récente en premier : date courte et prénoms ; un appui la rouvre.
  function dessinerConferences() {
    const liste = ctx.etat.conferences.filter((c) => c && c.id && Array.isArray(c.participants) && Array.isArray(c.messages)).reverse();
    $("confs-titre").hidden = !liste.length;
    $("confs").replaceChildren(...liste.map((c) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "carte conf-passee";
      const quand = new Date(c.date);
      const date = Number.isNaN(quand.getTime()) ? "" : quand.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
      const noms = c.participants.map((id) => { const a = ctx.etat.avatars.find((x) => x.id === id); return a ? a.nom.split(/\s+/)[0] : id; });
      b.textContent = [date, noms.join(", ")].filter(Boolean).join(" · ");
      b.onclick = () => ctx.rouvrirConference(c);
      return b;
    }));
  }

  function dessiner() {
    const etat = ctx.etat;
    for (const id of [...coches]) if (!etat.avatars.some((a) => a.id === id)) coches.delete(id);
    $("bandeau").hidden = !!etat.reglages.cle;
    $("liste").replaceChildren(...etat.avatars.map((a) => {
      const carte = document.createElement("label");
      carte.className = "carte";
      const caseACocher = document.createElement("input");
      caseACocher.type = "checkbox";
      caseACocher.checked = coches.has(a.id);
      caseACocher.setAttribute("aria-label", `Choisir ${a.nom}`);
      caseACocher.onchange = () => { caseACocher.checked ? coches.add(a.id) : coches.delete(a.id); majBoutons(); };
      const pastille = document.createElement("div");
      pastille.className = "pastille";
      ctx.pastille(pastille, a);
      const texte = document.createElement("div");
      texte.className = "texte";
      const nom = document.createElement("div");
      nom.className = "nom";
      nom.textContent = a.nom;
      if (a.memoire && a.memoire.texte) {
        const c = document.createElement("span");
        c.className = "cerveau"; c.title = "Se souvient de toi"; c.textContent = " 🧠";
        nom.appendChild(c);
      }
      const lien = document.createElement("div");
      lien.className = "lien";
      lien.textContent = a.lien;
      texte.append(nom, lien);
      const crayon = document.createElement("button");
      crayon.className = "icone"; crayon.type = "button"; crayon.textContent = "✎";
      crayon.setAttribute("aria-label", `Fiche de ${a.nom}`);
      crayon.onclick = (e) => { e.preventDefault(); ctx.ouvrirFiche(a, "liste"); };
      carte.append(caseACocher, pastille, texte, crayon);
      return carte;
    }));
    dessinerConferences();
    majBoutons();
  }

  $("appeler").onclick = () => {
    const a = ctx.etat.avatars.find((c) => coches.has(c.id));
    if (coches.size === 1 && a) ctx.ouvrirChat(a);
  };

  $("conference").onclick = () => {
    const ids = ctx.etat.avatars.filter((a) => coches.has(a.id)).map((a) => a.id);
    if (ids.length >= 2 && ids.length <= 4) ctx.ouvrirConference(ids);
  };

  $("ajouter").onclick = async () => {
    const nom = prompt("Nom du nouveau coach ?");
    if (nom === null) return;
    const lien = prompt("Son rôle (ex. sport et santé) ?");
    if (lien === null) return;
    Object.assign(ctx.etat, ajouterCoach(ctx.etat, { nom, lien }));
    await ctx.sauver();
    ctx.ouvrirFiche(ctx.etat.avatars[ctx.etat.avatars.length - 1], "liste");
  };

  return { dessiner };
}
