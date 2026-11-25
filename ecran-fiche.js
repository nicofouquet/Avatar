// Écran « Fiche » d'un coach : photo, nom, rôle, fiche, voix, mémoire (oublier / annuler), suppression.
import { supprimerCoach, oublierSouvenir, annulerMemoire } from "./donnees.js";
import { preparerPhoto } from "./photo.js";
import { VOIX } from "./voix.js";

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
