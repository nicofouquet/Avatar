// Stockage IndexedDB : un seul magasin « etat », une seule entrée « principal ».
// Remplace localStorage (trop petit pour photos et longues conversations).
import { charger } from "./donnees.js";

const MAGASIN = "etat";
const CLE = "principal";
const ANCIENNES_CLES = ["avatar.donnees", "avatar.reglages"];

export function ouvrir(nomBase = "avatar") {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(nomBase, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(MAGASIN);
    r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); ok(r.result); };
    r.onerror = () => ko(r.error);
    r.onblocked = () => ko(new Error("Base bloquée"));
  });
}

function lireEntree(base) {
  return new Promise((ok, ko) => {
    const r = base.transaction(MAGASIN, "readonly").objectStore(MAGASIN).get(CLE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

// Écrit avec put (remplace) ou add (échoue si l'entrée existe : résultat "existe").
function ecrire(base, etat, methode) {
  return new Promise((ok) => {
    try {
      let existe = false;
      const tx = base.transaction(MAGASIN, "readwrite");
      tx.oncomplete = () => ok(true);
      tx.onabort = () => ok(existe ? "existe" : false);
      const r = tx.objectStore(MAGASIN)[methode](etat, CLE);
      r.onerror = () => { if (r.error && r.error.name === "ConstraintError") existe = true; };
    } catch {
      ok(false);
    }
  });
}

// Renvoie false si le navigateur refuse (quota, erreur) ; l'écriture est validée à la fin de la transaction.
export async function ecrireEtat(base, etat) {
  return (await ecrire(base, etat, "put")) === true;
}

// Les lectures d'une même base sont mises à la queue : pas de migration en double dans la session.
const files = new WeakMap();

export function lireEtat(base, local = localStorage) {
  const suite = (files.get(base) || Promise.resolve()).then(() => lireEtatSeul(base, local));
  files.set(base, suite.catch(() => {}));
  return suite;
}

// Lit l'état ; si la base est vide, migre l'ancien localStorage (effacé seulement après écriture réussie).
async function lireEtatSeul(base, local) {
  let stocke;
  try { stocke = await lireEntree(base); } catch { return charger(local); }
  if (stocke) return stocke;
  const etat = charger(local);
  const res = await ecrire(base, etat, "add");
  if (res === "existe") {
    // Un autre onglet a migré entre-temps : on rend son résultat, sans rien écraser.
    try { return (await lireEntree(base)) || etat; } catch { return etat; }
  }
  if (res === true) {
    // Une clé illisible (JSON corrompu) est gardée : on pourrait la récupérer à la main.
    for (const k of ANCIENNES_CLES) {
      try {
        const brut = local.getItem(k);
        if (brut != null) JSON.parse(brut);
        local.removeItem(k);
      } catch { /* corrompue ou erreur : on la garde */ }
    }
  }
  return etat;
}
