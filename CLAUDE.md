# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MIRA Agent is an Electron-based desktop automation platform (virtueller Mitarbeiter / virtual employee). It uses AI vision to locate UI elements, execute recorded workflows ("routes"), and process documents. The desktop app communicates with a backend API deployed on Vercel.

## Commands

### Desktop App (Electron)
```bash
npm start              # Run in development
npm run build          # Build for current platform
npm run build:mac      # Build macOS DMG (x64 + arm64)
npm run build:win      # Build Windows NSIS installer
npm run build:all      # Build all platforms
```

**Note:** `@nut-tree/nut-js` requires a private registry. The `.npmrc` file configures `pkg.nutjs.dev` with an auth token. Run `npm install` before building — `postinstall` runs `electron-rebuild -f -w sharp` automatically.

`npm run build:all` / `build:mac` / `build:win` all go through `scripts/build-all.js`, which:
1. Compiles `ax-helper.swift` → `resources/ax-helper` (Mac only, needs `swiftc`)
2. Compiles `ax-helper-win/` → `resources/ax-helper-win.exe` (Windows only, needs `.NET 8 SDK`)
3. Detects pre-built binaries already in `resources/` (e.g. `.exe` committed from Windows)
4. Calls `electron-builder` only with targets whose binaries are present — skips with a warning if missing

Cross-platform note: `net8.0-windows` (UseWindowsForms) **cannot be cross-compiled from Mac**. Build `ax-helper-win.exe` on Windows with `npm run build:ax-win`, commit it to `resources/`, then `npm run build:all` on Mac will pick it up automatically.

### Backend Server (`server-Mira-main:api auf vercel/`)
```bash
npm start    # Production (node api/index.js)
npm run dev  # Development with nodemon
```

## Architecture

### Desktop App (Electron)

**`main.js`** (2173 lines) is the sole main process file. It handles:
- Window management: main UI + multiple overlay windows (calibration, route recording, training, setup wizard)
- IPC handlers bridging the renderer processes with system-level APIs
- Task polling loop: every 5 seconds polls the backend `/api/agent/poll`, receives a task JSON, executes it, and reports results
- Device control via `@nut-tree/nut-js` for mouse/keyboard and `uiohook-napi` for global input capture
- Screenshot capture, compressed via `sharp`

**Key task types dispatched in main.js:**
- `START_TRAINING` — opens training overlay
- `SCAN_FOLDER` — reads files via `pdfjs-dist`, `mammoth`, `exceljs`, then sends content to backend
- `EXECUTE_ROUTE` — replays a recorded sequence of mouse/keyboard steps
- `EXTRACT_DATA` — parses documents and returns structured data
- `DIALOG` — prompts user and returns response

**Supporting modules:**
- `screen-calibrator.js` — measures logical vs. physical pixels, calculates `scaleX`/`scaleY` factors relative to the 1280×720 recording baseline, detects dock/menubar, stores results in `calibration.json`
- `desktop-map.js` — builds a 9-zone grid of the screen, provides coordinate scaling utilities and Claude-readable layout context
- `ax-layer.js` — Cross-platform abstraction over OS Accessibility APIs. Auto-detects `process.platform` and calls the correct binary. On Mac: `resources/ax-helper` (Swift, AXUIElement). On Windows: `resources/ax-helper-win.exe` (C#, UI Automation). Methods: `getFrontmostApp()`, `findElement(desc, {bundleId})`, `getElements(bundleId)`, `getFocusedElement()`, `getElementAt(x,y)`, `checkPermission()`, `isPermissionGranted()`. Returns identical JSON on both platforms.
- `ax-helper.swift` / `resources/ax-helper` — macOS Swift CLI binary. Commands: `check-permission`, `frontmost`, `focused`, `find <desc> [--bundle <id>]`, `list [--bundle <id>]`, `at --x N --y N`. All return JSON. Coordinates: top-left origin (flipped from AX Quartz internally).
- `ax-helper-win/` — Windows C# project (`.csproj` + `Program.cs`). Targets `net8.0-windows`, uses `System.Windows.Automation`. Commands identical to Mac binary. Coordinates: top-left origin natively (no conversion needed). `bundleId` on Windows = process name without `.exe` (e.g. `"EXCEL"`, `"chrome"`).
- `context-manager.js` — Singleton that reads a full AX state snapshot once per `executeStep` (cached 400ms). Methods: `captureState(force?)` → `StateSnapshot`, `findInState(state, desc)` → element or null, `toPromptString(state)` → LLM context string, `toShortString(state)`, `invalidate()`. The snapshot includes: frontmost app, app type (mail/excel/word/browser/finder/…), window title, focused element, all visible interactive elements, structured field list. Pass `toPromptString()` output as `context:` field in all backend API calls.

**HTML overlays** are separate `BrowserWindow` instances:
- `route-overlay.html` — top-left panel for recording routes
- `calibration-overlay.html` — calibration UI
- `training-overlay.html` / `pc-training-overlay.html` — AI training feedback
- `mira-setup-overlay.html` — first-run device setup wizard
- `zone-capture.html` — zone boundary capture

### Backend API (`server-Mira-main:api auf vercel/api/index.js`)

Express.js server deployed on Vercel. Uses Supabase (PostgreSQL) as the database and integrates with both Claude (Anthropic) and OpenAI APIs.

**Two main subsystems:**

1. **`/api/agent/*`** — desktop agent control
   - `POST /api/agent/poll` — returns next queued task for the device
   - `POST /api/agent/execute` — runs a task with Claude reasoning
   - `POST /api/agent/route/save|run|list` — route CRUD
   - `POST /api/agent/scan-folder` / `scan-result` — folder scanning pipeline
   - `POST /api/agent/analyze-file` — Claude analyzes a document
   - `POST /api/agent/screen-learn` / `calibrate` — screen layout learning

2. **`/api/brain/*`** — vision and AI reasoning
   - `POST /api/brain/mini-find` — vision: locate a UI element in a screenshot
   - `POST /api/brain/mini-verify` — vision: verify a UI state
   - `POST /api/brain/memory-save` — persist learnings
   - `POST /api/brain/dispatch` — orchestrate multi-step tasks
   - `POST /api/brain/training-start` — begin training session

**MIRA Personality Engine:** The backend has a system of personality modules (`character.js`, `human.js`, `business.js`, `philosophy.js`, `technical.js`, `learnings.js`, `news.js`, `vorlagen.js`, `grenzsituationen.js`) injected into Claude prompts to give MIRA a consistent identity and knowledge base.

**Auth:** JWT tokens + PIN-based activation. Devices register with a redeem code and receive a token stored locally via `electron-store` (encrypted).

### Data Flow for Task Execution

```
Backend queues a task (via API or UI)
    → Desktop polls /api/agent/poll (every 5s)
    → main.js parses task JSON
    → Executes locally (mouse clicks, file reads, screenshots)
    → Calls /api/brain/mini-find to locate elements via vision
    → Reports result to /api/agent/complete
```

### Coordinate System

All routes are recorded at a 1280×720 logical resolution baseline. `screen-calibrator.js` computes `scaleX` and `scaleY` factors stored in `calibration.json`. Every coordinate used for mouse control must be scaled through these factors before execution on the actual device.

**Exception: AX Layer coordinates** — AXUIElement returns logical screen-pixel coordinates directly (top-left origin, no scaling needed). The `ax-helper` binary performs the Quartz→screen coordinate flip internally (`screenH - axY - elementHeight`). Coordinates from `axLayer.findElement()` can be passed directly to `mouse.setPosition()`.

### Click Coordinate Resolution (main.js `executeStep`, `case 'click'`)

Five-tier fallback chain — each tier only runs if the previous found nothing:

| Tier | Source | Cost | Speed |
|---|---|---|---|
| 0a | `contextManager.findInState()` — JS search in cached AX snapshot | free | <1ms |
| 0b | `axFind()` — deep AX subprocess tree search | free | ~20ms |
| 1 | `/api/brain/resolve-step` + `context:` string | API | ~300ms |
| 2 | `/api/brain/mini-find` — GPT-4o-mini on screenshot | API + $ | ~800ms |
| 3 | `scaleWithCalibration()` — recorded training coords | free | <1ms |

Screenshot is only taken if Tier 0a+0b both fail (lazy evaluation).
`contextManager.toPromptString()` is passed as `context:` to Tier 1 and `case 'extract'` — replaces/enriches screenshots with structured OS-level knowledge.
`contextManager.invalidate()` is called after every click, type, and key-press.

### Voice Command (index.html + main.js IPC)

Voice button in the dashboard triggers the pipeline:
1. `getUserMedia` → `AudioContext + AnalyserNode` monitors RMS level at ~60fps
2. Silence < `SILENCE_THRESHOLD` (0.012 RMS) for ≥ 1500ms → auto-stop (no manual stop needed)
3. `webkitSpeechRecognition` (Chromium built-in, `lang: de-DE`) transcribes continuously
4. On stop: transcript sent via `ipcRenderer.invoke('voice-command', { text })`
5. Main process captures context via `contextManager.captureState()`, sends to `/api/agent/queue` with `source: 'voice'` and `context:` string
6. Visual: ripple animation while listening, countdown bar during silence, transcript preview card

## Key Dependencies

| Package | Purpose |
|---|---|
| `@nut-tree/nut-js` ^4.2.0 | Mouse/keyboard automation (private registry) |
| `sharp` ^0.34.5 | Screenshot compression before API upload |
| `uiohook-napi` ^1.5.4 | Global input event capture for route recording |
| `electron-store` ^8.2.0 | Encrypted local storage (tokens, device data) |
| `pdfjs-dist`, `mammoth`, `exceljs` | Document reading (PDF, DOCX, XLSX) |
| `pdfkit`, `docx` | Document generation |
| `@anthropic-ai/sdk` | Claude API (backend) |
| `@supabase/supabase-js` | Database (backend) |
