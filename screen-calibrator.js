// ═══════════════════════════════════════
// screen-calibrator.js — MIRA Präzisions-Kalibrierung
// Misst jeden Bildschirm exakt aus
// Speichert calibration.json für perfekte Koordinaten
// ═══════════════════════════════════════

const { screen: electronScreen } = require('electron');
const { mouse, screen: nutScreen } = require('@nut-tree/nut-js');
const fs = require('fs');
const path = require('path');

const CALIBRATION_FILE = path.join(__dirname, 'calibration.json');

// ── Kalibrierung laden wenn vorhanden ──
function loadCalibration() {
  try {
    if (fs.existsSync(CALIBRATION_FILE)) {
      const data = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
      console.log(`📐 Kalibrierung geladen: scaleX=${data.scaleX.toFixed(4)} scaleY=${data.scaleY.toFixed(4)}`);
      return data;
    }
  } catch(e) {
    console.warn('⚠️ Kalibrierung laden fehlgeschlagen:', e.message);
  }
  return null;
}

// ── Kalibrierung speichern ──
function saveCalibration(data) {
  try {
    fs.writeFileSync(CALIBRATION_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log(`💾 Kalibrierung gespeichert: ${CALIBRATION_FILE}`);
  } catch(e) {
    console.error('❌ Kalibrierung speichern:', e.message);
  }
}

// ── Hauptkalibrierung ──
async function runCalibration() {
  console.log('🔬 Starte Präzisions-Kalibrierung...');

  // ── 1. Electron Display Info ──
  const display = electronScreen.getPrimaryDisplay();
  const logicalW = display.bounds.width;
  const logicalH = display.bounds.height;
  const scaleFactor = display.scaleFactor || 1;
  const workArea = display.workArea;

  console.log(`📺 Display: ${logicalW}x${logicalH} | ScaleFactor: ${scaleFactor}`);
  console.log(`🖥️ WorkArea: ${workArea.width}x${workArea.height} (x:${workArea.x} y:${workArea.y})`);

  // ── 2. Nut.js Bildschirmgröße (physische Pixel) ──
  const nutW = await nutScreen.width();
  const nutH = await nutScreen.height();
  console.log(`🔭 Nut.js Bildschirm: ${nutW}x${nutH}`);

  // ── 3. Test-Klick Kalibrierung ──
  // Klicke auf bekannte Positionen und messe wo Maus wirklich landet
  const testPoints = [
    { logical: [logicalW * 0.25, logicalH * 0.25], name: 'oben-links' },
    { logical: [logicalW * 0.75, logicalH * 0.25], name: 'oben-rechts' },
    { logical: [logicalW * 0.5,  logicalH * 0.5],  name: 'mitte' },
    { logical: [logicalW * 0.25, logicalH * 0.75], name: 'unten-links' },
    { logical: [logicalW * 0.75, logicalH * 0.75], name: 'unten-rechts' },
  ];

  const measurements = [];

  for (const point of testPoints) {
    const [lx, ly] = point.logical;

    // Maus bewegen
    await mouse.setPosition({ x: Math.round(lx), y: Math.round(ly) });
    await sleep(80);

    // Maus-Position auslesen
    const actual = await mouse.getPosition();
    measurements.push({
      name: point.name,
      expected: [Math.round(lx), Math.round(ly)],
      actual: [actual.x, actual.y],
      diffX: actual.x - Math.round(lx),
      diffY: actual.y - Math.round(ly)
    });

    console.log(`   📍 ${point.name}: erwartet [${Math.round(lx)}, ${Math.round(ly)}] → tatsächlich [${actual.x}, ${actual.y}]`);
  }

  // ── 4. Durchschnittlichen Offset berechnen ──
  const avgDiffX = measurements.reduce((s, m) => s + m.diffX, 0) / measurements.length;
  const avgDiffY = measurements.reduce((s, m) => s + m.diffY, 0) / measurements.length;

  // ── 5. Skalierungsfaktoren berechnen ──
  // Recording ist immer 1280x720
  const RECORD_W = 1280;
  const RECORD_H = 720;

  // Echter Skalierungsfaktor von Recording zu nutW/nutH
  const rawScaleX = nutW / RECORD_W;
  const rawScaleY = nutH / RECORD_H;

  // Offset-korrigierter Faktor
  const correctedScaleX = rawScaleX;
  const correctedScaleY = rawScaleY;

  // ── 6. Dock und Menübar ──
  const menuBarHeight = workArea.y;
  const dockHeight = logicalH - workArea.height - workArea.y;
  const dockPosition = workArea.x > 0 ? 'left'
    : workArea.width < logicalW ? 'right'
    : 'bottom';

  // ── 7. Zonen für Bildschirm ──
  const zones = {
    menubar:   { top: 0,                    left: 0,          width: nutW, height: Math.round(menuBarHeight * rawScaleY) },
    workspace: { top: Math.round(menuBarHeight * rawScaleY), left: Math.round(workArea.x * rawScaleX), width: Math.round(workArea.width * rawScaleX), height: Math.round(workArea.height * rawScaleY) },
    dock:      { position: dockPosition,    height: Math.round(dockHeight * rawScaleY) }
  };

  // ── 8. Kalibrierung speichern ──
  const calibration = {
    version: '1.0',
    createdAt: new Date().toISOString(),

    // Bildschirm
    screen: {
      logical: { width: logicalW, height: logicalH },
      physical: { width: nutW, height: nutH },
      scaleFactor,
      workArea
    },

    // Skalierung von 1280x720 Recording → echter Bildschirm
    scaleX: correctedScaleX,
    scaleY: correctedScaleY,

    // Offset (falls Maus systematisch daneben liegt)
    offsetX: Math.round(avgDiffX),
    offsetY: Math.round(avgDiffY),

    // Zonen
    zones,
    dock: { position: dockPosition, height: dockHeight, menuBarHeight },

    // Test-Messungen
    measurements
  };

  saveCalibration(calibration);

  console.log(`✅ Kalibrierung fertig!`);
  console.log(`   ScaleX: ${correctedScaleX.toFixed(4)} | ScaleY: ${correctedScaleY.toFixed(4)}`);
  console.log(`   Offset: x=${Math.round(avgDiffX)} y=${Math.round(avgDiffY)}`);
  console.log(`   Dock: ${dockPosition} (${dockHeight}px) | Menübar: ${menuBarHeight}px`);

  return calibration;
}

// ── Koordinate präzise skalieren mit Kalibrierung ──
function scaleWithCalibration(recordX, recordY, recordW, recordH, calibration) {
  if (!calibration) return { x: recordX, y: recordY };

  const srcW = recordW || 1280;
  const srcH = recordH || 720;

  const x = Math.round((recordX / srcW) * calibration.screen.physical.width) + calibration.offsetX;
  const y = Math.round((recordY / srcH) * calibration.screen.physical.height) + calibration.offsetY;

  return { x, y };
}

// ── Zone bestimmen ──
function getZone(x, y, calibration) {
  if (!calibration) return 'unbekannt';
  const { zones, screen } = calibration;

  if (y < zones.menubar.height) return 'Menüleiste';
  if (zones.dock.position === 'bottom' && y > screen.physical.height - zones.dock.height) return 'Dock';
  if (zones.dock.position === 'left' && x < zones.dock.height) return 'Dock';
  if (zones.dock.position === 'right' && x > screen.physical.width - zones.dock.height) return 'Dock';

  const ws = zones.workspace;
  const relX = (x - ws.left) / ws.width;
  const relY = (y - ws.top) / ws.height;
  const col = relX < 0.33 ? 'links' : relX < 0.66 ? 'mitte' : 'rechts';
  const row = relY < 0.33 ? 'oben' : relY < 0.66 ? 'mitte' : 'unten';
  return `${row}-${col}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  runCalibration,
  loadCalibration,
  scaleWithCalibration,
  getZone
};