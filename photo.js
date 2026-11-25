// Prépare une photo de coach : carré recadré au centre, 512 px, JPEG qualité 0.8 (data-URL).
// Accepte un fichier ou Blob choisi sur le téléphone, ou une data-URL (image renvoyée par le service portraits).
const TAILLE = 512;

function charger(source) {
  return new Promise((ok, ko) => {
    const objet = typeof source === "string" ? null : URL.createObjectURL(source);
    const libere = () => { if (objet) URL.revokeObjectURL(objet); };
    const img = new Image();
    img.onload = () => { libere(); ok(img); };
    img.onerror = () => { libere(); ko(new Error("Image illisible")); };
    img.src = objet || source;
  });
}

export async function preparerPhoto(source) {
  const img = await charger(source);
  const l = img.naturalWidth, h = img.naturalHeight;
  if (!l || !h) throw new Error("Image illisible");
  const cote = Math.min(l, h);
  const c = document.createElement("canvas");
  c.width = c.height = TAILLE;
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, TAILLE, TAILLE); // fond blanc : un PNG transparent ne devient pas noir en JPEG
  x.drawImage(img, (l - cote) / 2, (h - cote) / 2, cote, cote, 0, 0, TAILLE, TAILLE);
  return c.toDataURL("image/jpeg", 0.8);
}
