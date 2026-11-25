// Voix : liste des voix Gemini proposées pour un coach, et dictée au micro.
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
