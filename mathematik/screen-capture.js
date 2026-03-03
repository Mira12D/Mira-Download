// mathematik/screen-capture.js
// MIRA's Auge — Desktop als Zahlenmatrix
// Kein API. Kein Vision. Pure Pixel → Float32Array.

'use strict';

const sharp  = require('sharp');
const screen = require('screenshot-desktop');

/**
 * Nimmt einen Screenshot und gibt ihn als Float32Array zurück.
 * Grayscale (1 Kanal) → 3x weniger Rechenaufwand als RGB.
 *
 * @returns {{ pixels: Float32Array, width: number, height: number }}
 */
async function capture() {
  const raw = await screen({ format: 'png' });

  const { data, info } = await sharp(raw)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Uint8 (0-255) → Float32 (0.0-1.0) — normalisiert für NCC
  const pixels = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    pixels[i] = data[i] / 255.0;
  }

  return { pixels, width: info.width, height: info.height };
}

/**
 * Lädt ein gespeichertes Pattern-Bild (PNG) als Float32Array.
 * Wird beim Training gespeichert, hier geladen.
 *
 * @param {string} pngPath
 * @returns {{ pixels: Float32Array, width: number, height: number }}
 */
async function loadTemplate(pngPath) {
  const { data, info } = await sharp(pngPath)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    pixels[i] = data[i] / 255.0;
  }

  return { pixels, width: info.width, height: info.height };
}

/**
 * Schneide einen Ausschnitt aus dem Screen-Buffer heraus.
 * Für Training: User markiert Bereich → wir speichern das als Template.
 *
 * @param {Buffer} pngBuffer
 * @param {{ x, y, w, h }} region
 * @returns {Promise<Buffer>} PNG-Buffer des Ausschnitts
 */
async function cropRegion(pngBuffer, { x, y, w, h }) {
  return sharp(pngBuffer)
    .extract({ left: x, top: y, width: w, height: h })
    .png()
    .toBuffer();
}

module.exports = { capture, loadTemplate, cropRegion };
