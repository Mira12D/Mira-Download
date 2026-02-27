// ═══════════════════════════════════════
// desktop-map.js — MIRA Desktop Mapper
// Lernt einmal die Desktop-Struktur kennen
// und hilft bei präzisen Koordinaten
// ═══════════════════════════════════════

const { screen: electronScreen } = require('electron');
const { mouse, screen: nutScreen } = require('@nut-tree/nut-js');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const fetch = require('node-fetch');

let desktopMap = null;

// ── Einmal beim Start aufrufen ──
async function buildDesktopMap() {
  try {
    console.log('🗺️ Desktop Map wird erstellt...');

    // ── 1. Bildschirmgröße exakt messen ──
    const display = electronScreen.getPrimaryDisplay();
    const realWidth = display.bounds.width;
    const realHeight = display.bounds.height;
    const scaleFactor = display.scaleFactor || 1;
    const workArea = display.workArea; // Bereich ohne Dock/Menübar

    // ── 2. Dock analysieren ──
    const dockHeight = realHeight - workArea.height - workArea.y;
    const menuBarHeight = workArea.y;
    const dockPosition = workArea.x > 0 ? 'left'
      : workArea.width < realWidth ? 'right'
      : 'bottom';

    // ── 3. Skalierungsfaktoren zu Recording-Format ──
    const RECORD_W = 1280;
    const RECORD_H = 720;
    const scaleX = realWidth / RECORD_W;
    const scaleY = realHeight / RECORD_H;

    // ── 4. Zonen definieren ──
    const zones = {
      menubar: {
        top: 0, left: 0,
        width: realWidth, height: menuBarHeight,
        description: 'Menüleiste oben'
      },
      desktop: {
        top: menuBarHeight, left: workArea.x,
        width: workArea.width, height: workArea.height,
        description: 'Arbeitsbereich'
      },
      dock: {
        position: dockPosition,
        height: dockHeight,
        width: dockPosition === 'bottom' ? realWidth : workArea.x || (realWidth - workArea.width - workArea.x),
        description: `Dock (${dockPosition})`
      }
    };

    // ── 5. Raster aufteilen (9 Zonen) ──
    const gridW = workArea.width / 3;
    const gridH = workArea.height / 3;
    const grid = {
      top_left:     { x: workArea.x,           y: workArea.y,           w: gridW, h: gridH },
      top_center:   { x: workArea.x + gridW,    y: workArea.y,           w: gridW, h: gridH },
      top_right:    { x: workArea.x + gridW*2,  y: workArea.y,           w: gridW, h: gridH },
      mid_left:     { x: workArea.x,            y: workArea.y + gridH,   w: gridW, h: gridH },
      mid_center:   { x: workArea.x + gridW,    y: workArea.y + gridH,   w: gridW, h: gridH },
      mid_right:    { x: workArea.x + gridW*2,  y: workArea.y + gridH,   w: gridW, h: gridH },
      bot_left:     { x: workArea.x,            y: workArea.y + gridH*2, w: gridW, h: gridH },
      bot_center:   { x: workArea.x + gridW,    y: workArea.y + gridH*2, w: gridW, h: gridH },
      bot_right:    { x: workArea.x + gridW*2,  y: workArea.y + gridH*2, w: gridW, h: gridH },
    };

    desktopMap = {
      screen: {
        width: realWidth,
        height: realHeight,
        scaleFactor,
        workArea
      },
      scale: {
        toReal: { x: scaleX, y: scaleY },
        toRecord: { x: 1/scaleX, y: 1/scaleY }
      },
      zones,
      grid,
      dock: {
        position: dockPosition,
        height: dockHeight,
        menuBarHeight
      },
      createdAt: new Date().toISOString()
    };

    console.log(`✅ Desktop Map: ${realWidth}x${realHeight} | Dock: ${dockPosition} (${dockHeight}px) | Menübar: ${menuBarHeight}px`);
    console.log(`📐 Skalierung: 1280x720 → ${realWidth}x${realHeight} (${scaleX.toFixed(3)}x, ${scaleY.toFixed(3)}y)`);

    return desktopMap;

  } catch(e) {
    console.error('❌ Desktop Map Fehler:', e.message);
    // Fallback
    desktopMap = {
      screen: { width: 1280, height: 720, scaleFactor: 1 },
      scale: { toReal: { x: 1, y: 1 }, toRecord: { x: 1, y: 1 } },
      dock: { position: 'bottom', height: 70, menuBarHeight: 25 },
      createdAt: new Date().toISOString()
    };
    return desktopMap;
  }
}

// ── Koordinate von Recording → echter Bildschirm ──
function scaleCoordinate(recordX, recordY, recordW, recordH) {
  if (!desktopMap) return { x: recordX, y: recordY };

  const realW = desktopMap.screen.width;
  const realH = desktopMap.screen.height;

  // Skalierung basierend auf Recording-Größe
  const srcW = recordW || 1280;
  const srcH = recordH || 720;

  const x = Math.round((recordX / srcW) * realW);
  const y = Math.round((recordY / srcH) * realH);

  return { x, y };
}

// ── Zone für eine Koordinate bestimmen ──
function getZoneForCoord(x, y) {
  if (!desktopMap) return 'unbekannt';
  const { workArea } = desktopMap.screen;
  const { menuBarHeight, height: dockHeight, position: dockPos } = desktopMap.dock;

  if (y < menuBarHeight) return 'Menüleiste';
  if (dockPos === 'bottom' && y > desktopMap.screen.height - dockHeight) return 'Dock';
  if (dockPos === 'left' && x < dockHeight) return 'Dock';
  if (dockPos === 'right' && x > desktopMap.screen.width - dockHeight) return 'Dock';

  // 9er Raster
  const relX = (x - workArea.x) / workArea.width;
  const relY = (y - workArea.y) / workArea.height;
  const col = relX < 0.33 ? 'links' : relX < 0.66 ? 'mitte' : 'rechts';
  const row = relY < 0.33 ? 'oben' : relY < 0.66 ? 'mitte' : 'unten';
  return `${row}-${col}`;
}

// ── Context-String für Claude generieren ──
function getMapContext(step) {
  if (!desktopMap) return '';

  const { screen, dock, scale } = desktopMap;
  const scaledCoord = step.coordinate
    ? scaleCoordinate(step.coordinate[0], step.coordinate[1], step.screen_width, step.screen_height)
    : null;

  const zone = scaledCoord ? getZoneForCoord(scaledCoord.x, scaledCoord.y) : null;

  return `
BILDSCHIRM-LAYOUT:
- Größe: ${screen.width}x${screen.height}px
- Menüleiste: oben, ${dock.menuBarHeight}px hoch
- Dock: ${dock.position}, ${dock.height}px
- Arbeitsbereich: ${screen.workArea?.width}x${screen.workArea?.height}px

AUFNAHME → JETZT:
- Recording war: ${step.screen_width || 1280}x${step.screen_height || 720}px
- Jetzt: ${screen.width}x${screen.height}px
- Skalierung: ${scale.toReal.x.toFixed(3)}x horizontal, ${scale.toReal.y.toFixed(3)}x vertikal
${scaledCoord ? `
KLICK-POSITION:
- Aufgenommen bei: [${step.coordinate[0]}, ${step.coordinate[1]}]
- Skaliert auf jetzt: [${scaledCoord.x}, ${scaledCoord.y}]
- Zone auf Bildschirm: ${zone}
- Was ist dort vermutlich: ${zone === 'Dock' ? 'App im Dock' : zone === 'Menüleiste' ? 'Menü-Element' : 'Element im Arbeitsbereich'}` : ''}`;
}

module.exports = {
  buildDesktopMap,
  scaleCoordinate,
  getZoneForCoord,
  getMapContext,
  getMap: () => desktopMap
};