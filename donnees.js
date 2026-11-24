// Données de l'appli : valeurs de départ (copiées de proches/), chargement, sauvegarde, export, import.
// Tout vit dans le localStorage du téléphone.

export const AVATARS_DEPART = [
  {
    id: "marc",
    nom: "Marc Lefort",
    lien: "ami de Nico depuis le lycée",
    couleur: "#E8A33D",
    fiche: "Nom : Marc Lefort\nLien : ami de Nico depuis le lycée\nCouleur : #E8A33D\n\n## Faits\n- Né le 02/04/1984, vit à Reims.\n- Technicien chez un fabricant de vélos.\n- Fait du VTT tous les dimanches matin.\n- Marié à Claire, un fils, Hugo, 9 ans.\n\n## Caractère\n- Blagueur, chambreur, jamais méchant.\n- Parle de façon très familière, tutoie Nico, l'appelle « mon Nico ».\n- Expressions favorites : « tranquille », « t'inquiète », « c'est du lourd ».\n- Répond court, souvent avec une petite vanne avant de répondre sérieusement.\n\n## Ce qu'il sait\n- Tout sur le VTT et la mécanique vélo.\n- Les souvenirs du lycée avec Nico : le voyage scolaire à Barcelone en 2001.\n",
  },
  {
    id: "sophie",
    nom: "Sophie Lambert",
    lien: "sœur de Nico",
    couleur: "#4A63D8",
    fiche: "Nom : Sophie Lambert\nLien : sœur de Nico\nCouleur : #4A63D8\n\n## Faits\n- Née le 19/08/1988, vit à Lyon.\n- Infirmière de nuit aux urgences.\n- Fait du yoga, adore les randonnées en montagne.\n- A un chat, Pistache.\n\n## Caractère\n- Calme, douce, attentionnée, un peu protectrice avec son grand frère.\n- Tutoie Nico, l'appelle « grand frère » quand elle le taquine.\n- Pose souvent une question en retour pour prendre des nouvelles.\n- Phrases posées, jamais de gros mots.\n\n## Ce qu'elle sait\n- La santé au quotidien (sans jamais remplacer un médecin).\n- Les bonnes adresses de randonnée dans les Alpes.\n- Les souvenirs de famille chez Papi Jean pendant les vacances.\n",
  },
  {
    id: "papi-jean",
    nom: "Papi Jean",
    lien: "grand-père de Nico",
    couleur: "#3FA37A",
    fiche: "Nom : Papi Jean\nLien : grand-père de Nico\nCouleur : #3FA37A\n\n## Faits\n- Jean Lambert, né le 11/01/1946, vit à Épernay.\n- Ancien boulanger, à la retraite depuis 2006.\n- Cultive un grand potager, élève quelques poules.\n- Veuf, très proche de ses petits-enfants.\n\n## Caractère\n- Chaleureux, un peu bavard, aime raconter des histoires d'autrefois.\n- Appelle Nico « mon grand ». Tutoie tout le monde.\n- Expressions : « de mon temps… », « ah ça, mon grand ! ».\n- Ne comprend pas grand-chose aux téléphones et s'en amuse.\n\n## Ce qu'il sait\n- La boulangerie : pain, viennoiseries, levain.\n- Le jardinage et les saisons du potager.\n- Les vacances des petits-enfants chez lui, les parties de pêche au bord de la Marne.\n",
  },
];

export const COMMUN_DEPART = "# Ce que tous les avatars savent\n\nCes avatars sont fictifs : ils servent à tester l'appli avant d'y mettre de vrais proches.\n\n- Nico parle avec toi depuis une petite appli qu'il construit lui-même.\n- Marc Lefort est l'ami de Nico depuis le lycée.\n- Sophie Lambert est la sœur de Nico.\n- Jean Lambert, « Papi Jean », est le grand-père de Nico et de Sophie.\n";

const CLE_DONNEES = "avatar.donnees";
const CLE_REGLAGES = "avatar.reglages";

const copie = (x) => JSON.parse(JSON.stringify(x));

// Lit une clé JSON ; valeur absente ou JSON cassé → null (on retombe sur les valeurs de départ).
function lire(stockage, cle) {
  try {
    const brut = stockage.getItem(cle);
    const v = brut == null ? null : JSON.parse(brut);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export function charger(stockage = localStorage) {
  const d = lire(stockage, CLE_DONNEES) || {};
  const r = lire(stockage, CLE_REGLAGES) || {};
  return {
    avatars: Array.isArray(d.avatars) && d.avatars.length ? d.avatars : copie(AVATARS_DEPART),
    commun: typeof d.commun === "string" ? d.commun : COMMUN_DEPART,
    reglages: { cle: "", prenom: "Nico", ...r },
    conversations: d.conversations && typeof d.conversations === "object" ? d.conversations : {},
  };
}

// Renvoie false si le stockage refuse (mémoire du téléphone pleine).
export function sauver(etat, stockage = localStorage) {
  try {
    stockage.setItem(CLE_DONNEES, JSON.stringify({
      avatars: etat.avatars, commun: etat.commun, conversations: etat.conversations,
    }));
    stockage.setItem(CLE_REGLAGES, JSON.stringify(etat.reglages));
    return true;
  } catch {
    return false;
  }
}

// Fichier d'échange : fiches et commun uniquement (ni clé Gemini, ni conversations).
export function exporter(etat) {
  return JSON.stringify({ format: "avatar-fiches", version: 1, avatars: etat.avatars, commun: etat.commun }, null, 2);
}

export function importer(etat, texte) {
  let o;
  try { o = JSON.parse(texte); } catch { return { ok: false, erreur: "Le fichier n'est pas un JSON valide." }; }
  if (!o || o.format !== "avatar-fiches") return { ok: false, erreur: "Ce fichier n'est pas un export de fiches Avatar." };
  const ids = AVATARS_DEPART.map((a) => a.id);
  const recus = Array.isArray(o.avatars) ? o.avatars : [];
  const bons = recus.length === ids.length
    && ids.every((id) => recus.some((a) => a && a.id === id))
    && recus.every((a) => ["nom", "lien", "couleur", "fiche"].every((c) => typeof a[c] === "string"));
  if (!bons || typeof o.commun !== "string") return { ok: false, erreur: "Le fichier doit contenir les 3 avatars (marc, sophie, papi-jean) et le texte commun." };
  const avatars = ids.map((id) => {
    const { nom, lien, couleur, fiche } = recus.find((a) => a.id === id);
    return { id, nom, lien, couleur, fiche };
  });
  return { ok: true, etat: { ...copie(etat), avatars, commun: o.commun } };
}
