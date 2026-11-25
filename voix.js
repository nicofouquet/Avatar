// Voix : liste des voix Gemini, synthèse vocale (voix de secours du téléphone) et dictée au micro.
export const VOIX = [
  { nom: "Zephyr", etiquette: "claire" },
  { nom: "Puck", etiquette: "enjouée" },
  { nom: "Charon", etiquette: "posée, informative" },
  { nom: "Kore", etiquette: "ferme" },
  { nom: "Fenrir", etiquette: "vive" },
  { nom: "Leda", etiquette: "jeune" },
  { nom: "Orus", etiquette: "ferme, grave" },
  { nom: "Aoede", etiquette: "légère" },
  { nom: "Algenib", etiquette: "grave, éraillée" },
  { nom: "Algieba", etiquette: "douce" },
  { nom: "Achird", etiquette: "amicale" },
  { nom: "Sulafat", etiquette: "chaleureuse" },
  { nom: "Vindemiatrix", etiquette: "douce, calme" },
  { nom: "Gacrux", etiquette: "mûre" },
  { nom: "Schedar", etiquette: "égale" },
  { nom: "Sadaltager", etiquette: "savante" },
];

// ---------- Synthèse vocale Gemini (PCM 16 bits, mono, 24 000 Hz) ----------

// Le modèle principal d'abord ; au moindre quota ou saturation, le modèle de secours.
export const MODELES_VOIX = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const DELAI_VOIX = 20000;

// Enveloppe du PCM brut dans un fichier WAV (en-tête de 44 octets).
export function pcmVersWav(pcm, frequence = 24000) {
  const n = pcm.length;
  const tete = new DataView(new ArrayBuffer(44));
  const ecrire = (pos, t) => { for (let i = 0; i < t.length; i++) tete.setUint8(pos + i, t.charCodeAt(i)); };
  ecrire(0, "RIFF"); tete.setUint32(4, 36 + n, true); ecrire(8, "WAVE");
  ecrire(12, "fmt "); tete.setUint32(16, 16, true); tete.setUint16(20, 1, true); tete.setUint16(22, 1, true);
  tete.setUint32(24, frequence, true); tete.setUint32(28, frequence * 2, true);
  tete.setUint16(32, 2, true); tete.setUint16(34, 16, true);
  ecrire(36, "data"); tete.setUint32(40, n, true);
  return new Blob([tete, pcm], { type: "audio/wav" });
}

function base64VersOctets(b64) {
  const bin = atob(b64);
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}

// -> {audio: Blob|null, erreur, secours?}. `secours: true` : quota ou saturation, l'appelant peut prendre la voix du navigateur.
// `signal` : abandon demandé par l'appelant (erreur "annule"). Un modèle qui vient de répondre 429 est évité pendant 5 minutes.
const PAUSE_QUOTA = 5 * 60 * 1000;
const quotaJusqua = new Map(); // modèle -> instant de fin de l'évitement
export const oublierQuotas = () => quotaJusqua.clear();

export async function synthetiser({ cle, texte, voix, emotion = "neutre", fetch = globalThis.fetch, signal, delai = DELAI_VOIX, maintenant = Date.now }) {
  if (!cle) return { audio: null, erreur: "cle_absente" };
  const corps = JSON.stringify({
    contents: [{ parts: [{ text: `Lis le texte suivant en français. ${voix.description}. Ton : ${emotion}.\n\n${texte}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voix.nom } } },
    },
  });
  let quota = false;
  for (const modele of MODELES_VOIX) {
    if (signal?.aborted) return { audio: null, erreur: "annule" };
    if ((quotaJusqua.get(modele) ?? 0) > maintenant()) { quota = true; continue; }
    // Un seul signal pour la requête : délai maximal ou abandon de l'appelant.
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), delai);
    const abandon = () => ctrl.abort();
    signal?.addEventListener("abort", abandon);
    try {
      const r = await fetch(`${URL_BASE}${modele}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": cle },
        body: corps,
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => null);
      if (r.ok) {
        const b64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (b64) return { audio: pcmVersWav(base64VersOctets(b64)), erreur: null };
        continue; // réponse sans audio : modèle suivant
      }
      if (r.status === 429) { quota = true; quotaJusqua.set(modele, maintenant() + PAUSE_QUOTA); }
      const message = String(data?.error?.message ?? "");
      if ([400, 401, 403].includes(r.status) && /api key/i.test(message)) return { audio: null, erreur: "cle_refusee" };
    } catch (e) {
      if (signal?.aborted) return { audio: null, erreur: "annule" };
      // Délai dépassé : modèle suivant ; TypeError réseau : hors ligne.
      if (e instanceof TypeError) return { audio: null, erreur: "hors_ligne" };
    } finally {
      clearTimeout(minuteur);
      signal?.removeEventListener("abort", abandon);
    }
  }
  return { audio: null, erreur: quota ? "quota" : "sature", secours: true };
}

// ---------- Lecture ----------

// Un seul élément <audio>, réutilisé : Chrome Android n'autorise play() après une longue attente (réseau)
// que sur un élément déjà « débloqué » par un geste de Nico (deverrouiller()).
let lecteur = null, ouvert = false, termine = null; // termine(raison) : fin de la lecture en cours
const element = () => (lecteur ||= new Audio());

// À appeler dans un geste de Nico (envoi, micro, haut-parleur) : joue un silence très court.
export function deverrouiller() {
  if (ouvert || termine) return;
  try {
    const a = element();
    const url = URL.createObjectURL(pcmVersWav(new Uint8Array(480)));
    a.src = url;
    const p = a.play();
    ouvert = true;
    p?.catch?.(() => { ouvert = false; });
    a.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  } catch { ouvert = false; }
}

// Joue un Blob audio. Résout "fini", "arrete" (arreterVoix) ou "refuse" (le navigateur refuse la lecture : voix du téléphone).
// Un « ended » qui ne vient jamais ne bloque rien : plafond = durée de l'audio + 5 s (`plafond` ms tant que la durée est inconnue).
export function jouer(audio, { element: el = element(), plafond = 120000 } = {}) {
  return new Promise((resoudre) => {
    termine?.("arrete");
    const url = URL.createObjectURL(audio);
    let fini = false, minuteur = null;
    const armer = (ms) => { clearTimeout(minuteur); minuteur = setTimeout(() => { try { el.pause(); } catch { /* sans effet */ } fin("fini"); }, ms); };
    const surFin = () => fin("fini"), surErreur = () => fin("refuse");
    const surDuree = () => { if (Number.isFinite(el.duration) && el.duration > 0) armer(el.duration * 1000 + 5000); };
    function fin(raison) {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      el.removeEventListener("ended", surFin);
      el.removeEventListener("error", surErreur);
      el.removeEventListener("loadedmetadata", surDuree);
      URL.revokeObjectURL(url);
      if (termine === fin) termine = null;
      resoudre(raison);
    }
    fin.element = el;
    el.addEventListener("ended", surFin);
    el.addEventListener("error", surErreur);
    el.addEventListener("loadedmetadata", surDuree);
    termine = fin;
    armer(plafond);
    try {
      el.src = url;
      const p = el.play();
      p?.catch?.(() => fin("refuse"));
    } catch { fin("refuse"); }
  });
}

const HOMME = /thomas|paul|henri|nicolas|daniel|martin|male\b|homme/i;
const FEMME = /am[eé]lie|marie|audrey|julie|l[eé]a|female|femme|google fran/i;

// Voix du navigateur (secours) : français, de préférence du même genre que la description.
// L'énoncé courant est gardé en référence (Chrome peut le ramasser avant « onend ») et un plafond évite qu'une fin manquante bloque la file :
// max(5 s, 80 ms par caractère), ou `delaiMax` ms.
let enonceCourant = null;
export function parlerNavigateur(texte, { voix, fenetre = globalThis, delaiMax } = {}) {
  const synth = fenetre.speechSynthesis;
  const Enonce = fenetre.SpeechSynthesisUtterance;
  if (!synth || !Enonce) return Promise.resolve();
  return new Promise((resoudre) => {
    const u = new Enonce(texte);
    u.lang = "fr-FR";
    const francaises = (synth.getVoices?.() ?? []).filter((v) => /^fr/i.test(v.lang));
    const desc = String(voix?.description ?? "");
    const masculin = /\bhomme\b|\bgar[cç]on\b|\bmasculin/i.test(desc) && !/\bfemme\b/i.test(desc);
    const feminin = /\bfemme\b|\bfille\b|\bf[eé]minin/i.test(desc);
    const motif = masculin ? HOMME : feminin ? FEMME : null;
    const choisie = (motif && francaises.find((v) => motif.test(v.name))) || francaises[0];
    if (choisie) u.voice = choisie;
    let minuteur = null;
    const fini = () => { clearTimeout(minuteur); if (enonceCourant === u) enonceCourant = null; resoudre(); };
    u.onend = fini;
    u.onerror = fini;
    enonceCourant = u;
    minuteur = setTimeout(() => { try { synth.cancel?.(); } catch { /* sans effet */ } fini(); }, delaiMax ?? Math.max(8000, 150 * String(texte).length + 3000)); // marge large : une voix lente ne doit pas être coupée
    try { synth.speak(u); } catch { fini(); }
  });
}

// Sur Android, getVoices() est souvent vide au début : on le sollicite dès le chargement et à chaque « voiceschanged ».
export function preparerVoixNavigateur(fenetre = globalThis) {
  try {
    const s = fenetre.speechSynthesis;
    if (!s) return;
    s.getVoices?.();
    s.addEventListener?.("voiceschanged", () => s.getVoices?.());
  } catch { /* sans effet */ }
}
preparerVoixNavigateur();

export function arreterVoix(fenetre = globalThis) {
  try { fenetre.speechSynthesis?.cancel(); } catch { /* sans effet */ }
  const fin = termine;
  if (fin) { try { fin.element?.pause(); } catch { /* sans effet */ } fin("arrete"); }
}

// Dictée : la parole devient du texte (Web Speech API de Chrome, en français).
// ecouter() renvoie le texte dicté ; rejette avec "refuse" (micro interdit), "rien" (aucune parole), "annule" (écoute interrompue) ou "erreur".
export function micro(fenetre = globalThis) {
  const Reco = fenetre.SpeechRecognition || fenetre.webkitSpeechRecognition;
  let courante = null;
  return {
    disponible: !!Reco,
    ecouter({ surPartiel } = {}) {
      return new Promise((resoudre, rejeter) => {
        if (!Reco) { rejeter("refuse"); return; }
        const r = new Reco();
        r.lang = "fr-FR";
        r.interimResults = true;
        r.continuous = false;
        let texte = "", erreur = null;
        r.onresult = (e) => {
          texte = Array.from(e.results, (res) => res[0].transcript).join("").trim();
          surPartiel?.(texte);
        };
        r.onerror = (e) => {
          erreur = e.error === "not-allowed" || e.error === "service-not-allowed" ? "refuse"
            : e.error === "no-speech" ? "rien" : e.error === "aborted" ? "annule" : "erreur";
        };
        r.onend = () => {
          if (courante === r) courante = null;
          if (texte) resoudre(texte);
          else rejeter(erreur || "rien");
        };
        try { r.start(); courante = r; } catch { rejeter("erreur"); }
      });
    },
    arreter() { courante?.stop(); },
  };
}
