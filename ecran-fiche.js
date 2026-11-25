// Écran « Fiche » d'un coach : photo (choisie ou portrait généré), nom, rôle, fiche, voix, mémoire (oublier / annuler), suppression.
import { supprimerCoach, oublierSouvenir, annulerMemoire } from "./donnees.js";
import { preparerPhoto } from "./photo.js";
import { VOIX } from "./voix.js";
import { genererPortrait, URL_PORTRAITS, MESSAGES_ERREUR } from "./portrait.js";

export function initFiche(ctx) {
  const { $ } = ctx;
  let coach = null, photo = null, depuis = "liste";
  // Le coach de la fiche est toujours relu par identifiant : après un import ou une suppression, l'objet gardé serait détaché de l'état.
  const courant = () => { coach = coach ? ctx.coachDe(coach.id) : null; return coach; };

  const lignes = (texte) => String(texte || "").split("\n").map((l) => l.trim()).filter(Boolean);

  function dessinerPhoto() {
    ctx.pastille($("f-photo"), { ...coach, photo });
    $("f-choisir").textContent = photo ? "Changer" : "Choisir une photo";
  }

  function dessinerMemoire() {
    const prenom = coach.nom.split(/\s+/)[0] || coach.nom;
    $("f-titre-souvenirs").textContent = `Ce que ${prenom} sait de toi`;
    const l = lignes(coach.memoire.texte);
    if (!l.length) {
      const p = document.createElement("li");
      p.className = "vide"; p.style.border = "0"; p.textContent = "Rien pour l'instant.";
      $("souvenirs").replaceChildren(p);
    } else {
      $("souvenirs").replaceChildren(...l.map((ligne, i) => {
        const li = document.createElement("li");
        const t = document.createElement("span");
        t.textContent = ligne;
        const b = document.createElement("button");
        b.className = "icone"; b.type = "button"; b.textContent = "×";
        b.setAttribute("aria-label", `Oublier : ${ligne}`);
        b.onclick = async () => {
          if (!courant()) return;
          // On retrouve la ligne par son texte dans la mémoire actuelle : la liste affichée a pu changer (résumé arrivé entre-temps).
          const k = lignes(coach.memoire.texte).indexOf(ligne);
          if (k < 0) { dessinerMemoire(); return; }
          coach.memoire = oublierSouvenir(coach.memoire, k); dessinerMemoire(); await ctx.sauver();
        };
        li.append(t, b);
        return li;
      }));
    }
    $("f-annuler-mem").hidden = coach.memoire.precedente === null;
  }

  function ouvrir(c, origine) {
    coach = c; photo = c.photo; depuis = origine;
    $("f-nom").value = c.nom;
    $("f-lien").value = c.lien;
    $("f-fiche").value = c.fiche;
    const choix = VOIX.map((v) => ({ nom: v.nom, texte: `${v.nom} (${v.etiquette})` }));
    if (!choix.some((v) => v.nom === c.voix.nom)) choix.push({ nom: c.voix.nom, texte: c.voix.nom });
    $("f-voix").replaceChildren(...choix.map((v) => new Option(v.texte, v.nom)));
    $("f-voix").value = c.voix.nom;
    $("f-voix-desc").value = c.voix.description;
    $("f-msg").textContent = "";
    fermerPortrait(); // ferme le panneau et invalide tout portrait encore en cours pour le coach précédent
    dessinerPhoto();
    dessinerMemoire();
    ctx.aller("fiche");
  }

  const modifiee = () => !!courant() && ($("f-nom").value !== coach.nom || $("f-lien").value !== coach.lien || $("f-fiche").value !== coach.fiche
    || photo !== coach.photo || $("f-voix").value !== coach.voix.nom || $("f-voix-desc").value !== coach.voix.description);

  $("f-choisir").onclick = () => $("f-fichier").click();
  $("f-fichier").onchange = async () => {
    const f = $("f-fichier").files[0];
    $("f-fichier").value = "";
    if (!f) return;
    $("f-msg").textContent = "Préparation de la photo…";
    try { photo = await preparerPhoto(f); $("f-msg").textContent = ""; dessinerPhoto(); }
    catch { $("f-msg").textContent = "Image illisible : choisis une autre photo."; }
  };


  // ---------- Portrait généré (service Cloudflare) ----------
  // jeton : change à chaque ouverture de fiche et à chaque « Recommencer » ; un résultat tardif d'un autre coach (ou d'un essai abandonné) est ignoré.
  let jeton = 0, essai = null; // essai : image prête (data-URL 512 px) en attente de « Garder »

  function messagePortrait(texte) { $("f-portrait-msg").textContent = texte; }
  function etatPortrait(enCours) {
    $("f-portrait-gen").disabled = enCours;
    $("f-portrait-gen").textContent = enCours ? "Création du portrait…" : "Générer";
    $("f-portrait-gen").hidden = !!essai;
    $("f-portrait-garder").hidden = !essai;
    $("f-portrait-refaire").hidden = !essai;
    $("f-portrait-img").hidden = !essai;
    if (essai) $("f-portrait-img").src = essai;
  }
  function fermerPortrait() { jeton++; essai = null; $("f-portrait").hidden = true; messagePortrait(""); etatPortrait(false); }

  const descriptionDepart = () => {
    const v = coach.voix.description.trim();
    return `Portrait de ${coach.nom}, ${coach.lien || "coach de vie"}${v ? ` (${v})` : ""}.`;
  };

  $("f-creer").onclick = () => {
    if (!courant()) return;
    if ($("f-portrait").hidden) { $("f-portrait-desc").value = descriptionDepart(); essai = null; messagePortrait(""); etatPortrait(false); }
    $("f-portrait").hidden = false;
  };
  $("f-portrait-fermer").onclick = fermerPortrait;

  $("f-portrait-gen").onclick = async () => {
    if (!courant() || $("f-portrait-gen").disabled) return;
    const moi = ++jeton, id = coach.id;
    const r = ctx.etat.reglages;
    messagePortrait("");
    etatPortrait(true);
    const res = await genererPortrait({
      url: r.portraitUrl || URL_PORTRAITS, motDePasse: r.portraitMotDePasse || "",
      description: $("f-portrait-desc").value, cle: r.cle,
    });
    if (moi !== jeton || !courant() || coach.id !== id) return; // fiche quittée ou autre coach ouvert entre-temps
    let image = res.image, erreur = res.erreur;
    if (image) {
      try { image = await preparerPhoto(image); } catch { image = null; erreur = "service"; }
      if (moi !== jeton || !courant() || coach.id !== id) return;
    }
    essai = image;
    messagePortrait(image ? "" : MESSAGES_ERREUR[erreur] || MESSAGES_ERREUR.service);
    etatPortrait(false);
  };
  $("f-portrait-refaire").onclick = () => { jeton++; essai = null; messagePortrait(""); etatPortrait(false); };
  $("f-portrait-garder").onclick = () => {
    if (!courant() || !essai) return;
    photo = essai; // comme une photo choisie : enregistrée avec la fiche (Enregistrer)
    dessinerPhoto();
    fermerPortrait();
    $("f-msg").textContent = "Portrait gardé : touche Enregistrer pour le conserver.";
  };
  $("f-annuler-mem").onclick = async () => { if (!courant()) return; coach.memoire = annulerMemoire(coach.memoire); dessinerMemoire(); await ctx.sauver(); };

  $("fiche-annuler").onclick = () => ctx.retour(false);
  $("fiche-ok").onclick = async () => {
    if (!courant()) return;
    coach.nom = $("f-nom").value.trim() || coach.nom;
    coach.lien = $("f-lien").value.trim();
    coach.fiche = $("f-fiche").value;
    coach.photo = photo;
    coach.voix = { nom: $("f-voix").value, description: $("f-voix-desc").value.trim() };
    ctx.retour(true);
    await ctx.sauver();
  };

  $("f-supprimer").onclick = async () => {
    if (!courant()) return;
    if (!confirm(`Supprimer ${coach.nom} ? Sa fiche, sa mémoire et ses conversations seront effacées.`)) return;
    const id = coach.id;
    Object.assign(ctx.etat, supprimerCoach(ctx.etat, id));
    coach = null;
    ctx.apresSuppression(id);
    ctx.retour(true, depuis === "chat" ? 2 : 1);
    await ctx.sauver();
  };

  // Un résumé vient d'arriver pour ce coach : on redessine sa mémoire si la fiche est ouverte dessus.
  function rafraichir(id) { if (coach && coach.id === id && courant()) dessinerMemoire(); }

  return { ouvrir, modifiee, ouverte: () => !!courant(), rafraichir };
}
