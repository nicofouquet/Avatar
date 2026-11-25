// Écran « Réglages » : clé, service portraits (adresse, mot de passe), prénom, texte commun, rappels de confidentialité et d'export, export / import.
import { exporter, importer, conversationsPerdues } from "./donnees.js";
import { URL_PORTRAITS } from "./portrait.js";

const TRENTE_JOURS = 30 * 24 * 3600 * 1000;

export function initReglages(ctx) {
  const { $ } = ctx;

  function rappels() {
    const r = ctx.etat.reglages;
    $("r-gratuite").hidden = $("r-payante").checked;
    const quand = r.dernierExport ? Date.parse(r.dernierExport) : NaN;
    $("r-rappel").hidden = !(Number.isNaN(quand) || Date.now() - quand > TRENTE_JOURS);
  }

  function ouvrir() {
    const etat = ctx.etat;
    $("r-cle").value = etat.reglages.cle;
    $("r-prenom").value = etat.reglages.prenom;
    $("r-portrait-url").value = etat.reglages.portraitUrl || URL_PORTRAITS;
    $("r-portrait-mdp").value = etat.reglages.portraitMotDePasse || "";
    $("r-commun").value = etat.commun;
    $("r-payante").checked = !!etat.reglages.clePayante;
    $("r-msg").textContent = "";
    rappels();
    ctx.aller("reglages");
  }

  $("r-payante").onchange = rappels;
  $("reglages-annuler").onclick = () => ctx.retour(false);
  $("reglages-ok").onclick = async () => {
    const etat = ctx.etat;
    etat.reglages.cle = $("r-cle").value.trim();
    etat.reglages.prenom = $("r-prenom").value.trim() || "Nico";
    etat.reglages.portraitUrl = $("r-portrait-url").value.trim() || URL_PORTRAITS;
    etat.reglages.portraitMotDePasse = $("r-portrait-mdp").value.trim();
    etat.reglages.clePayante = $("r-payante").checked;
    etat.commun = $("r-commun").value;
    ctx.retour(false);
    await ctx.sauver();
  };

  $("exporter").onclick = async () => {
    const etat = ctx.etat;
    const nom = `avatar-fiches-${new Date().toLocaleDateString("sv-SE")}.json`; // AAAA-MM-JJ, date locale
    const lien = document.createElement("a");
    lien.href = URL.createObjectURL(new Blob([exporter(etat)], { type: "application/json" }));
    lien.download = nom;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
    etat.reglages.dernierExport = new Date().toISOString();
    rappels();
    $("r-msg").textContent = `Fichier ${nom} créé.`;
    await ctx.sauver();
  };

  $("importer").onclick = () => $("fichier").click();
  $("fichier").onchange = async () => {
    const f = $("fichier").files[0];
    $("fichier").value = "";
    if (!f) return;
    const etat = ctx.etat;
    let contenu;
    try { contenu = await f.text(); } catch { $("r-msg").textContent = "Impossible de lire le fichier."; return; }
    const res = importer(etat, contenu);
    if (!res.ok) { $("r-msg").textContent = res.erreur; return; }
    // Un fichier v2 remplace les coachs ; il peut aussi remplacer ou retirer des conversations du téléphone : on demande d'abord.
    let v2 = false;
    try { v2 = JSON.parse(contenu).version === 2; } catch { /* déjà validé par importer */ }
    if (v2) {
      const perdues = conversationsPerdues(etat.conversations, res.etat.conversations);
      const texte = perdues
        ? "Ce fichier remplacera tes coachs (fiches, photos, mémoires) et tes conversations. Continuer ?"
        : "Ce fichier remplacera tes coachs (fiches, photos, mémoires). Continuer ?";
      if (!confirm(texte)) return;
    }
    const avant = etat.conversations; // l'ancien objet reste intact : importer a travaillé sur une copie
    const avantConf = etat.conferences;
    Object.assign(etat, res.etat);
    ctx.apresImport(avant, avantConf);
    $("r-commun").value = etat.commun;
    $("r-msg").textContent = "Coachs importés.";
    await ctx.sauver();
  };

  $("effacer").onclick = async () => {
    if (!confirm("Effacer toutes les conversations et conférences ? Les fiches sont gardées.")) return;
    ctx.etat.conversations = {};
    ctx.apresEffacement();
    $("r-msg").textContent = "Conversations et conférences effacées.";
    await ctx.sauver();
  };

  return { ouvrir };
}
