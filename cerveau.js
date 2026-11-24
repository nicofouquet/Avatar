// Le cerveau : appel direct à Gemini avec secours entre plusieurs modèles.
// Miroir de avatars.py (prompt, lecture de la réponse) et cerveau.py (modèles, schéma, tours).

export const EMOTIONS = ["neutre", "joie", "rire", "surprise", "tristesse", "reflexion", "agacement"];

// Les modèles légers d'abord (plus rapides, moins souvent saturés), le plus lourd en dernier.
export const MODELES = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"];

const SCHEMA = {
  type: "object",
  properties: {
    texte: { type: "string" },
    emotion: { type: "string", enum: EMOTIONS },
  },
  required: ["texte", "emotion"],
};

const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const DELAI_MAX = 35000; // au-delà (ms), on n'entame pas de nouveau tour

export function construirePrompt(avatar, commun, prenom) {
  return `Tu es ${avatar.nom}, et tu discutes avec ${prenom} par messages.
Tu incarnes cette personne : son caractère, sa façon de parler, ses expressions.
Réponses courtes, comme dans une vraie conversation.

Règles :
- Tu peux saluer et faire la conversation légère librement.
- Pour tout fait sur une personne (dates, lieux, métiers, souvenirs), utilise uniquement les informations ci-dessous.
- Si l'information n'y est pas, dis que tu ne sais pas (« je ne sais pas »), avec ton propre ton, sans inventer.
- Ne dis jamais que tu es une IA ou un modèle, sauf si ${prenom} te le demande directement.

Réponds uniquement en JSON : {"texte": "ta réponse", "emotion": "..."}
L'émotion décrit ton visage pendant que tu réponds, choisie parmi : ${EMOTIONS.join(", ")}.

Ce que tout le monde sait :
${commun}

Ta fiche :
${avatar.fiche}
`;
}

// Transforme la réponse du modèle en {texte, emotion}, sans jamais planter.
export function lireReponse(brut) {
  let texte, emotion;
  try {
    const data = JSON.parse(brut);
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("pas un objet");
    texte = String(data.texte ?? "").trim();
    emotion = data.emotion ?? "neutre";
  } catch {
    texte = String(brut).trim();
    emotion = "neutre";
  }
  if (!EMOTIONS.includes(emotion)) emotion = "neutre";
  return { texte, emotion };
}

const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function repondre({ cle, systeme, messages, fetch = globalThis.fetch, pause = 2000, tours = 2 }) {
  if (!cle) return { texte: "", emotion: "neutre", erreur: "cle_absente" };
  const echec = (erreur) => ({ texte: "", emotion: "neutre", erreur });

  const corps = JSON.stringify({
    systemInstruction: { parts: [{ text: systeme }] },
    contents: messages.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.texte }],
    })),
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
  });

  let quota = false;
  const debut = Date.now();
  for (let tour = 0; tour < tours; tour++) {
    if (tour > 0) {
      if (Date.now() - debut > DELAI_MAX) break;
      await attendre(pause);
    }
    for (const modele of MODELES) {
      try {
        const r = await fetch(`${URL_BASE}${modele}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": cle },
          body: corps,
          signal: AbortSignal.timeout(15000), // même délai que cerveau.py
        });
        const data = await r.json().catch(() => null);
        if (r.ok) {
          const brut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (brut) {
            const rep = lireReponse(brut);
            if (rep.texte) return { ...rep, erreur: null };
          }
          continue; // réponse vide (ou texte vide) : modèle suivant
        }
        if (r.status === 429) quota = true; // on essaie quand même les autres modèles
        const message = String(data?.error?.message ?? "");
        if ([400, 401, 403].includes(r.status) && /api key/i.test(message)) return echec("cle_refusee");
      } catch (e) {
        // Un délai dépassé (TimeoutError) passe au modèle suivant ; un TypeError réseau = hors ligne.
        if (e instanceof TypeError) return echec("hors_ligne");
      }
    }
  }
  return echec(quota ? "quota" : "sature");
}
