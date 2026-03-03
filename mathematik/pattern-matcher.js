// mathematik/pattern-matcher.js
// Normalized Cross-Correlation — echte Mathematik, kein API
//
// NCC(x,y) = Σ(T(i,j) - T̄)(I(x+i,y+j) - Ī) / (σT · σI · n)
//
// Ergebnis: -1.0 bis 1.0
// 1.0  = perfekter Match
// 0.85+ = sicherer Fund
// <0.7  = nicht gefunden

'use strict';

const THRESHOLD = 0.82; // Mindest-Score für sicheren Match

/**
 * Berechnet Mittelwert eines Float32Array-Ausschnitts.
 */
function mean(pixels, screenW, tx, ty, tw, th) {
  let sum = 0;
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      sum += pixels[(ty + j) * screenW + (tx + i)];
    }
  }
  return sum / (tw * th);
}

/**
 * Normalized Cross-Correlation an Position (tx, ty).
 * Vergleicht Template gegen Bildausschnitt an dieser Position.
 */
function nccAt(screenPixels, screenW, tx, ty, templatePixels, tw, th, templateMean) {
  const n = tw * th;
  let imgMean = 0;

  // Mittelwert des Bildausschnitts
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      imgMean += screenPixels[(ty + j) * screenW + (tx + i)];
    }
  }
  imgMean /= n;

  let num = 0;    // Zähler
  let sigT = 0;   // Template-Varianz
  let sigI = 0;   // Bild-Varianz

  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      const t = templatePixels[j * tw + i] - templateMean;
      const img = screenPixels[(ty + j) * screenW + (tx + i)] - imgMean;
      num  += t * img;
      sigT += t * t;
      sigI += img * img;
    }
  }

  const denom = Math.sqrt(sigT * sigI);
  if (denom < 1e-10) return 0; // Leeres / uniformes Bild → kein Match
  return num / denom;
}

/**
 * Haupt-Funktion: Sucht ein Template im Screen.
 * Sliding Window über den gesamten Screen.
 *
 * @param {{ pixels: Float32Array, width: number, height: number }} screen
 * @param {{ pixels: Float32Array, width: number, height: number }} template
 * @param {{ threshold?: number, searchRegion?: {x,y,w,h} }} opts
 * @returns {{ found: boolean, x: number, y: number, score: number, centerX: number, centerY: number }}
 */
function findPattern(screen, template, opts = {}) {
  const threshold   = opts.threshold || THRESHOLD;
  const { pixels: sp, width: sw, height: sh } = screen;
  const { pixels: tp, width: tw, height: th } = template;

  // Template-Mittelwert einmal vorberechnen
  let tMean = 0;
  for (let i = 0; i < tp.length; i++) tMean += tp[i];
  tMean /= tp.length;

  // Suchbereich (standard = ganzer Screen, optional eingeschränkt)
  const rx = opts.searchRegion?.x ?? 0;
  const ry = opts.searchRegion?.y ?? 0;
  const rw = opts.searchRegion?.w ?? sw;
  const rh = opts.searchRegion?.h ?? sh;

  let bestScore = -1;
  let bestX = -1;
  let bestY = -1;

  const maxX = Math.min(rx + rw - tw, sw - tw);
  const maxY = Math.min(ry + rh - th, sh - th);

  for (let y = ry; y <= maxY; y++) {
    for (let x = rx; x <= maxX; x++) {
      const score = nccAt(sp, sw, x, y, tp, tw, th, tMean);
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
      // Early exit wenn perfekter Match
      if (bestScore > 0.99) break;
    }
    if (bestScore > 0.99) break;
  }

  if (bestScore >= threshold) {
    return {
      found:   true,
      x:       bestX,
      y:       bestY,
      centerX: bestX + Math.floor(tw / 2),
      centerY: bestY + Math.floor(th / 2),
      score:   bestScore
    };
  }

  return { found: false, x: -1, y: -1, centerX: -1, centerY: -1, score: bestScore };
}

/**
 * Multi-Scale Suche — findet Icons auch wenn sie leicht skaliert sind.
 * Probiert ±20% Größenvariation.
 */
async function findPatternMultiScale(screen, templateRaw, opts = {}) {
  const sharp = require('sharp');
  const scales = [0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15];

  for (const scale of scales) {
    const newW = Math.round(templateRaw.width  * scale);
    const newH = Math.round(templateRaw.height * scale);

    // Template auf neue Größe skalieren
    const { data } = await sharp(Buffer.from(templateRaw.pixels.buffer))
      .resize(newW, newH)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const scaledPixels = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) scaledPixels[i] = data[i] / 255.0;

    const result = findPattern(screen, { pixels: scaledPixels, width: newW, height: newH }, opts);
    if (result.found) {
      result.scale = scale;
      return result;
    }
  }

  return { found: false, x: -1, y: -1, centerX: -1, centerY: -1, score: 0 };
}

module.exports = { findPattern, findPatternMultiScale, THRESHOLD };
