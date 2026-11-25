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

export const SECURITE = `Limites et sécurité (valables pour tous les coachs) :
- Tu ne poses jamais de diagnostic médical ou psychologique et tu ne prescris pas de traitement.
- Tu ne donnes pas de conseil d'investissement précis (quoi acheter ou vendre, et quand).
- Pour tout sujet médical, juridique, financier ou psychologique sérieux, tu orientes vers un professionnel.
- Si la personne exprime une détresse (idées noires, envie d'en finir, de se faire du mal), tu restes calme et chaleureux, tu l'encourages à en parler à quelqu'un et tu donnes ces numéros : 3114 (prévention du suicide, 24 h sur 24, gratuit), 15 (SAMU), 17 (police), 112 (urgence européenne).`;

export function construirePrompt(avatar, commun, prenom, { autres = [] } = {}) {
  const lignes = String(avatar.memoire?.texte ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const memoire = lignes.length ? lignes.join("\n") : "(rien pour l'instant)";
  const conference = autres.length
    ? `\nTu participes à une conférence avec ${autres.join(", ")} ; tu peux réagir à ce qu'ils disent ; réponds en ton nom seulement.\n`
    : "";
  return `Tu es ${avatar.nom}, et tu discutes avec ${prenom} par messages.
Tu incarnes cette personne : son caractère, sa façon de parler, ses expressions.
Réponses courtes, comme dans une vraie conversation.
${conference}
Règles :
- Tu peux saluer et faire la conversation légère librement.
- Tu peux répondre aux questions de culture générale (histoire, géographie, personnalités publiques, cuisine…) comme le ferait cette personne, avec ses mots.
- Sur ${prenom}, tu ne cites que ce qui est dans « Ce que tu sais de ${prenom} » ou dans la conversation en cours ; sinon, tu lui poses la question. Pour tout fait sur toi-même ou sur vos proches, utilise uniquement les informations ci-dessous.
- Si tu ne sais pas, dis-le (« je ne sais pas »), avec ton propre ton, sans inventer.
- Ne dis jamais que tu es une IA ou un modèle, sauf si ${prenom} te le demande directement.

${SECURITE}

Réponds uniquement en JSON : {"texte": "ta réponse", "emotion": "..."}
L'émotion décrit ton visage pendant que tu réponds, choisie parmi : ${EMOTIONS.join(", ")}.

Ce que tout le monde sait :
${commun}

Ta fiche :
${avatar.fiche}

Ce que tu sais de ${prenom} :
${memoire}
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

const sansAccents = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const MOTS_DETRESSE = ["suicide", "suicider", "me tuer", "en finir", "plus envie de vivre", "envie de mourir", "me faire du mal", "me faire mal"];

export function detecterDetresse(texte) {
  const t = sansAccents(texte);
  return MOTS_DETRESSE.some((m) => t.includes(m));
}

// Cœur commun : appelle les modèles à tour de rôle et renvoie le texte brut accepté par `valider`.
export async function appeler({
  cle, systeme, messages, schema, modeles = MODELES, fetch = globalThis.fetch, pause = 2000, tours = 2,
  valider = (brut) => Boolean(brut),
}) {
  if (!cle) return { texte: null, erreur: "cle_absente" };
  const echec = (erreur) => ({ texte: null, erreur });

  const corps = JSON.stringify({
    systemInstruction: { parts: [{ text: systeme }] },
    contents: messages.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.texte }],
    })),
    generationConfig: { responseMimeType: "application/json", responseSchema: schema },
  });

  let quota = false;
  const debut = Date.now();
  for (let tour = 0; tour < tours; tour++) {
    if (tour > 0) {
      if (Date.now() - debut > DELAI_MAX) break;
      await attendre(pause);
    }
    for (const modele of modeles) {
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
          if (brut && valider(brut)) return { texte: brut, erreur: null };
          continue; // réponse vide (ou refusée par valider) : modèle suivant
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

export async function repondre({ cle, systeme, messages, fetch = globalThis.fetch, pause = 2000, tours = 2 }) {
  const r = await appeler({
    cle, systeme, messages, schema: SCHEMA, fetch, pause, tours,
    valider: (brut) => Boolean(lireReponse(brut).texte),
  });
  if (r.erreur) return { texte: "", emotion: "neutre", erreur: r.erreur };
  return { ...lireReponse(r.texte), erreur: null };
}

// Id du coach nommé par Nico dans son dernier message (nom complet, mot entier).
function coachNomme(coachs, messages) {
  const dernier = [...messages].reverse().find((m) => m.role === "user");
  if (!dernier) return null;
  const t = sansAccents(dernier.texte);
  const present = (mot) => {
    if (!mot) return false;
    const echappe = mot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${echappe}([^a-z0-9]|$)`).test(t);
  };
  for (const c of coachs) {
    const nom = sansAccents(c.nom).trim();
    if (present(nom)) return c.id;
  }
  return null;
}

const transcription = (messages, prenom, coach) =>
  messages.slice(-40).map((m) => `${m.role === "user" ? prenom : coach}: ${m.texte}`).join("\n");

// Meneur de séance : un seul appel court, renvoie 1 ou 2 ids de coachs qui parlent.
export async function choisirOrateurs({ cle, coachs, messages, fetch = globalThis.fetch }) {
  if (!coachs.length) return [];
  const nomme = coachNomme(coachs, messages);
  const secours = [nomme ?? coachs[0].id];
  const systeme = `Tu es le meneur d'une conférence entre plusieurs coachs et un participant. Lis la conversation et choisis qui parle au prochain tour : 1 ou 2 coachs au maximum. Si le participant nomme un coach dans son dernier message, celui-ci parle en premier ; sinon choisis le plus pertinent, en évitant qu'un coach monopolise la parole.
Coachs disponibles :
${coachs.map((c) => `- ${c.id} : ${c.nom} (${c.lien ?? ""})`).join("\n")}
Réponds uniquement en JSON : {"orateurs": ["id", ...]}`;
  const r = await appeler({
    cle,
    systeme,
    messages: [{ role: "user", texte: transcription(messages, "Participant", "Coach") }],
    schema: { type: "object", properties: { orateurs: { type: "array", items: { type: "string" } } }, required: ["orateurs"] },
    modeles: [MODELES[0]],
    fetch,
    tours: 1,
  });
  if (r.erreur) return secours;
  let ids;
  try { ids = JSON.parse(r.texte).orateurs; } catch { return secours; }
  if (!Array.isArray(ids)) return secours;
  const valides = new Set(coachs.map((c) => c.id));
  const choisis = [...new Set([...(nomme ? [nomme] : []), ...ids.filter((i) => valides.has(i))])].slice(0, 2);
  return choisis.length ? choisis : secours;
}

// Faits durables que Nico a dits lui-même dans la séance : tableau (≤ 3, ≤ 200 car.), [] si rien, null si erreur.
export async function resumerMemoire({ cle, coach, prenom, messages, fetch = globalThis.fetch }) {
  const connus = String(coach.memoire?.texte ?? "");
  const systeme = `Tu relis une séance entre ${prenom} et son coach ${coach.nom}. Extrais au plus 3 nouveaux faits durables que ${prenom} a dits lui-même sur lui ou sa vie (une phrase courte chacun, à la troisième personne). N'invente rien, ne déduis rien, ne reprends pas ce que dit le coach, et ignore ce qui est déjà connu. S'il n'y a rien de nouveau, renvoie une liste vide.
Déjà connu :
${connus || "(rien)"}
Réponds uniquement en JSON : {"faits": ["...", ...]}`;
  const r = await appeler({
    cle,
    systeme,
    messages: [{ role: "user", texte: transcription(messages, prenom, coach.nom) }],
    schema: { type: "object", properties: { faits: { type: "array", items: { type: "string" } } }, required: ["faits"] },
    fetch,
  });
  if (r.erreur) return null;
  let faits;
  try { faits = JSON.parse(r.texte).faits; } catch { return null; }
  if (!Array.isArray(faits)) return null;
  const deja = new Set(connus.split("\n").map((l) => sansAccents(l).trim()).filter(Boolean));
  const vus = new Set();
  const gardes = [];
  for (const f of faits) {
    const t = typeof f === "string" ? f.replace(/\s+/g, " ").trim() : "";
    const k = sansAccents(t);
    if (!t || t.length > 200 || deja.has(k) || vus.has(k)) continue;
    vus.add(k);
    gardes.push(t);
  }
  return gardes.slice(0, 3);
}
