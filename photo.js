// Prépare une photo de coach : carré recadré au centre, 512 px, JPEG qualité 0.8 (data-URL).
const TAILLE = 512;

function charger(fichier) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error("Image illisible")); };
    img.src = url;
  });
}

export async function preparerPhoto(fichier) {
  const img = await charger(fichier);
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
