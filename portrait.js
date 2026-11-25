// Service portraits : le Worker Cloudflare de Nico crée une image à partir d'une description.
// Si une clé Gemini est présente, la description française est d'abord traduite en anglais (le modèle d'image la comprend mieux).
import { appeler } from "./cerveau.js";

export const URL_PORTRAITS = "https://avatar-portraits.ni-fouquet.workers.dev/";
export const MESSAGES_ERREUR = {
  mot_de_passe: "Mot de passe du service portraits refusé : vérifie-le dans Réglages.",
  hors_ligne: "Pas de connexion. Réessaie quand tu as du réseau.",
  trop_long: "Description trop longue : raccourcis-la.",
  service: "Le service portraits n'a pas répondu, réessaie.",
};

export const MAX_DESCRIPTION = 500; // limite du Worker (qui ajoute lui-même le style du portrait)

const SYSTEME = "Tu traduis en anglais la description d'une personne pour un générateur de portraits. Réponds uniquement par un JSON {\"anglais\": \"…\"} contenant la traduction, sans rien ajouter ni inventer.";
const SCHEMA = { type: "object", properties: { anglais: { type: "string" } }, required: ["anglais"] };
const lireAnglais = (brut) => { try { const t = JSON.parse(brut).anglais; return typeof t === "string" && t.trim() ? t.trim() : null; } catch { return null; } };

async function traduire(description, cle, fetch) {
  const r = await appeler({
    cle, systeme: SYSTEME, messages: [{ role: "user", texte: description }], schema: SCHEMA, fetch,
    pause: 0, tours: 1, valider: (brut) => lireAnglais(brut) !== null,
  });
  return r.texte ? lireAnglais(r.texte) : null;
}

// -> { image: "data:image/jpeg;base64,…" | null, erreur: null | "mot_de_passe" | "hors_ligne" | "trop_long" | "service" }
export async function genererPortrait({ url, motDePasse, description, cle, fetch = globalThis.fetch }) {
  const echec = (erreur) => ({ image: null, erreur });
  // Un en-tête HTTP n'accepte que des caractères latins simples : un mot de passe accentué ne peut pas être envoyé.
  if (!motDePasse || !/^[\x20-\x7E]+$/.test(motDePasse)) return echec("mot_de_passe");
  let texte = String(description || "").trim();
  if (cle && texte) texte = (await traduire(texte, cle, fetch).catch(() => null)) || texte; // traduction ratée : description brute
  if (!texte) texte = "friendly person";
  if (texte.length > MAX_DESCRIPTION) { // traduction plus longue que prévu : on coupe sur une limite de mot
    const coupe = texte.slice(0, MAX_DESCRIPTION);
    texte = (/\s/.test(texte[MAX_DESCRIPTION]) ? coupe : coupe.replace(/\s+\S*$/, "") || coupe).trim();
  }
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Mot-De-Passe": motDePasse },
      body: JSON.stringify({ description: texte }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) { return echec(e && e.name === "TimeoutError" ? "service" : "hors_ligne"); } // trop lent : le service, pas le réseau
  if (r.status === 401) return echec("mot_de_passe");
  if (r.status === 400) return echec("trop_long");
  if (!r.ok) return echec("service");
  const data = await r.json().catch(() => null);
  const image = data && data.image;
  if (typeof image !== "string" || !image.startsWith("data:image/")) return echec("service");
  return { image, erreur: null };
}
