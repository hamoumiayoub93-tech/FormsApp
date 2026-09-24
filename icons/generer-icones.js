/*
 * Génère les icônes PNG de l'extension sans aucune dépendance (zlib de node).
 * Usage : node icons/generer-icones.js
 * Motif : carré bleu arrondi, feuille blanche avec lignes, coche verte.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bloc(type, donnees) {
  const lg = Buffer.alloc(4); lg.writeUInt32BE(donnees.length);
  const td = Buffer.concat([Buffer.from(type), donnees]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([lg, td, crc]);
}

function png(taille, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA 8 bits
  const brut = Buffer.alloc((taille * 4 + 1) * taille);
  for (let y = 0; y < taille; y++) {
    brut[y * (taille * 4 + 1)] = 0;
    pixels.copy(brut, y * (taille * 4 + 1) + 1, y * taille * 4, (y + 1) * taille * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut)), bloc('IEND', Buffer.alloc(0))
  ]);
}

// Couleur d'un point (coordonnées normalisées 0..1), ou null (transparent).
function couleur(x, y) {
  const dansRectArrondi = (x0, y0, x1, y1, r) => {
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  const distSegment = (ax, ay, bx, by) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
  };
  if (!dansRectArrondi(0.02, 0.02, 0.98, 0.98, 0.2)) return null;
  // coche verte
  if (distSegment(0.52, 0.70, 0.64, 0.82) < 0.055 || distSegment(0.64, 0.82, 0.88, 0.52) < 0.055) return [34, 197, 94];
  // feuille blanche
  if (dansRectArrondi(0.2, 0.16, 0.7, 0.84, 0.05)) {
    for (const ly of [0.32, 0.45, 0.58]) {
      if (Math.abs(y - ly) < 0.03 && x > 0.29 && x < 0.61) return [29, 78, 216];
    }
    return [255, 255, 255];
  }
  return [29, 78, 216]; // bleu
}

for (const taille of [16, 32, 48, 128]) {
  const px = Buffer.alloc(taille * taille * 4);
  const ss = 4; // sur-échantillonnage pour l'anticrénelage
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = couleur((x + (sx + 0.5) / ss) / taille, (y + (sy + 0.5) / ss) / taille);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const i = (y * taille + x) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; px[i + 3] = (255 * a) / (ss * ss); }
    }
  }
  fs.writeFileSync(path.join(__dirname, `icon${taille}.png`), png(taille, px));
}
console.log('Icônes générées.');
