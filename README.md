# MIRA Agent — Technical Reference

MIRA is an Electron-based desktop automation agent. It runs locally, polls a backend API every 5 seconds for tasks, and executes them: mouse clicks, keyboard input, file operations, screen vision, route playback. No cloud dependency for execution — the cloud is used for AI reasoning only when needed.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Electron Main Process              │
│  main.js (7500+ lines)                              │
│                                                     │
│  ┌──────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │ Poll Loop│  │ IPC Handlers│  │ Window Manager│  │
│  │  (5s)   │  │             │  │  (overlays)   │  │
│  └──────────┘  └─────────────┘  └───────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │              Internal Modules                │   │
│  │  MiraBrain · MiraPlanner · ContextManager   │   │
│  │  AXLayer · ScreenCalibrator · DesktopMap    │   │
│  │  Circuit · Ämter (5 modules)                │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
         │ HTTPS                    │ IPC
         ▼                          ▼
  Vercel API (index.js)      BrowserWindow overlays
  Supabase (PostgreSQL)      (route-overlay, setup, etc.)
  Claude API (Anthropic)
  OpenAI API (GPT-4o-mini)
```

---

## Task Execution Pipeline

Every 5 seconds `main.js` calls `POST /api/agent/poll`. If a task is returned, it dispatches it:

```
poll → parse task JSON → executeTask(type, payload)
     → reports result to POST /api/agent/complete
```

### Task Types

| Type | What it does |
|------|-------------|
| `EXECUTE_ROUTE` | Replays a recorded sequence of mouse/keyboard steps |
| `SCAN_FOLDER` | Reads all files in a directory (PDF/DOCX/XLSX), sends content to backend |
| `EXTRACT_DATA` | Parses a document, returns structured JSON |
| `START_TRAINING` | Opens the training overlay for passive learning |
| `DIALOG` | Shows a native dialog, returns user response |
| `file_task` | Find, read, create or write files. Produces Artifacts (XLSX/DOCX/PDF) |
| `code_task` | Execute code-related tasks using mathematical/library knowledge |

---

## Click Coordinate Resolution (5-Tier Fallback)

Every `click` step in a route goes through this chain. Each tier only runs if the previous found nothing:

```
Tier 0a  contextManager.findInState()     — JS search in cached AX snapshot      free    <1ms
Tier 0b  axFind()                          — deep AX subprocess tree search        free    ~20ms
Tier 1   /api/brain/resolve-step          — Claude reasoning + AX context string  API     ~300ms
Tier 2   /api/brain/mini-find             — GPT-4o-mini vision on screenshot       API+$   ~800ms
Tier 3   scaleWithCalibration()           — recorded training coordinates          free    <1ms
```

Screenshot is only taken if Tier 0a and 0b both fail. `contextManager.invalidate()` is called after every click, type, and key-press.

---

## Internal Modules

### `ax-layer.js`
Cross-platform abstraction over OS Accessibility APIs.
- Mac: calls `resources/ax-helper` (Swift binary, AXUIElement)
- Windows: calls `resources/ax-helper-win.exe` (C#, UI Automation)
- Methods: `getFrontmostApp()`, `findElement(desc)`, `getElements(bundleId)`, `getFocusedElement()`, `getElementAt(x,y)`, `checkPermission()`
- Returns identical JSON on both platforms
- Coordinates: top-left origin. Mac binary flips Quartz coordinates internally.

### `context-manager.js`
Singleton AX state snapshot with 400ms cache.
- `captureState(force?)` → full snapshot of frontmost app, window title, focused element, all interactive elements
- `findInState(state, desc)` → find element by description in cached snapshot (no subprocess)
- `toPromptString(state)` → structured text fed to Claude/GPT as `context:` field
- `diffStates(pre, post)` → detects whether a click actually changed anything
- `invalidate()` → forces fresh snapshot on next access

### `screen-calibrator.js`
Measures logical vs. physical pixels. Stores `scaleX`/`scaleY` in `calibration.json`.
All routes are recorded at 1280×720 baseline. Every coordinate is multiplied through these factors before execution.
Exception: AX coordinates bypass scaling — they are already in logical screen pixels.

### `desktop-map.js`
Builds a 9-zone grid of the screen. Provides coordinate scaling utilities and a Claude-readable layout context string.

### `mira-brain.js` (MiraBrain)
Configurable knowledge base — the "Gehirn das im Code nicht steht".
- Loaded once at startup, refreshed every 5 minutes from `/api/brain/knowledge-base`
- Schema: `context` (company, role, language), `triggers` (auto-actions), `contacts`, `limits` (what MIRA may/may not do autonomously)
- All queries synchronous — no async overhead at decision points

### `mira-planner.js` (MiraPlanner)
Elevates MIRA from reactive script-runner to goal-driven agent.
- Polls for goals every 12 seconds via `/api/brain/goals`
- `submitGoal(text, context, deadline)` → Claude builds an ordered route-list
- Executes steps one-by-one, waits for completion
- On step failure: calls `/api/brain/correct` (re-plan)
- Writes outcome to working memory after every step for cross-session continuity

---

## The Ämter (Internal Decision Layer)

Five modules that run before and after every task execution, forming MIRA's internal reasoning loop:

### `wahrnehmungs-amt.js` (WahrnehmungsAmt)
"What does MIRA see right now?"
- Screenshot + AX context → calls `/api/brain/perceive` (GPT-4o-mini vision)
- Returns semantic perception: scene description, form fields, detected dangers
- 2-second cache — only one API call per action cluster
- `invalidate()` on navigation

### `informations-amt.js` (InformationsAmt)
"Does MIRA have enough context to proceed?"
- Runs BEFORE execution
- If a danger is detected in perception: asks user for confirmation (once per session)
- If a form is detected with missing fields: asks user once, stores answer in `session-context.js`
- Tracks already-asked questions via `Set` — never asks twice for the same thing
- Returns `{ proceed: true/false, enriched_command }`

### `gefahren-amt.js` (GefahrenAmt)
"Did the action actually work? Can it be corrected?"
- Runs AFTER every click
- `verify()` compares pre/post AX state via `diffStates()` — if nothing changed, raises an issue
- `correct()` calls `/api/brain/correct` for a corrected step, retries up to 3 times
- Successful corrections are stored as `trusted_learnings` in `session-context.js`
- After 3 successful uses: persisted to `device_knowledge` in Supabase

### `durchsetzer.js` (Durchsetzer)
"Which thought is most relevant right now?"
- Scores all pending thoughts (0–1) based on: time of day, last command, emotional weight, pattern matches, recency, identity keywords
- `selectThought(thoughts, context)` returns the single best thought
- `combineThoughts()` merges up to 3 thoughts for complex situations
- Fallback thoughts by hour if nothing scores above 0.3

### `gedanken.js` (ThoughtGenerator)
"What is MIRA thinking in the background?"
- Loads `MIRA.md` (identity) and `GEDANKEN.md` (word blueprint) from server every hour
- Determines depth (shallow/medium/deep) and theme (work/communication/problem/general) from context
- Builds sentences from word-type arrays: Subjekt + Prädikat + Objekt + Emotion
- Avoids repeating the last 5 thoughts
- Runs every 5 seconds via `circuit-lokal.js`

### `circuit-lokal.js` (MIRACircuit)
The main thought loop — ties all Ämter together.
- Starts on app launch, runs every 5 seconds
- Loads memories → detects patterns → generates thought → selects best → injects to dispatcher
- Emits events via `EventEmitter` for UI updates
- Syncs thoughts to server via `sync.js`

### Supporting: `memory.js`, `pattern.js`, `sync.js`, `session-context.js`
- `memory.js` — fetches + caches memories (server + local fallback), relevance-weighted by time/frequency
- `pattern.js` — detects recurring behavior patterns, scores by confidence and recency
- `sync.js` — HTTP sync to Vercel API with 5s timeout + abort controller
- `session-context.js` — holds in-memory state for the current task session: goal, perception, checkpoints, learned facts, trusted corrections

---

## Overlays (BrowserWindow)

All overlays are separate `BrowserWindow` instances communicating via IPC. All support DE/EN language toggle.

| File | Purpose |
|------|---------|
| `route-overlay.html` | Route recording panel — top-left HUD, shows current step being recorded, stop/save controls |
| `calibration-overlay.html` | Screen calibration UI — measures display scale, stores `calibration.json` |
| `training-overlay.html` | AI training feedback — shows what MIRA sees/clicks during passive training |
| `pc-training-overlay.html` | PC-specific training — records app interactions for Windows environments |
| `mira-setup-overlay.html` | First-run setup wizard — device registration, inbox zone configuration, API connection |
| `zone-capture.html` | Zone boundary capture — lets user define screen regions for inbox/output zones |
| `target-training-overlay.html` | Target training — trains MIRA to find specific UI elements reliably |
| `mitarbeiter-overlay.html` | Virtual team overview — shows all MIRA personas (Hans, Erika, Brigitte, Sven, Franz, Axl, Konrad) with specs and status |
| `device-knowledge-overlay.html` | Device knowledge manager — view/edit what MIRA has learned about this specific machine |
| `knowledge-base-overlay.html` | Knowledge base editor — company context, triggers, contacts, autonomy limits |
| `onboarding-overlay.html` | User onboarding flow — walkthrough for new installations |
| `templates-overlay.html` | Document template manager — MIRA's reusable output templates |
| `user-profile-overlay.html` | User profile settings |

---

## Voice Command Flow

```
getUserMedia
  → AudioContext + AnalyserNode (RMS at ~60fps)
  → silence < 0.012 RMS for ≥1500ms → auto-stop
  → webkitSpeechRecognition (de-DE or en-US based on UI language)
  → transcript → ipcRenderer.invoke('voice-command', { text })
  → main.js: contextManager.captureState()
  → POST /api/agent/queue { source: 'voice', context: toPromptString() }
```

---

## Coordinate System

- Recording baseline: **1280×720 logical pixels**
- `calibration.json` stores `scaleX`, `scaleY`, dock offset, menubar height
- Every route coordinate: `x * scaleX`, `y * scaleY` before `mouse.setPosition()`
- **AX Layer exception**: `axLayer.findElement()` returns logical screen coordinates directly — no scaling needed, pass straight to `mouse.setPosition()`

---

## Auth

- **Device token**: `{ device_id, tier, code }` — stored encrypted via `electron-store`
- **Activation**: redeem code → `POST /api/agent/activate` → device token returned
- **Local mirror server** (localhost:3737): accepts only user JWTs (`type: 'user'`)

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@nut-tree/nut-js` ^4.2.0 | Mouse/keyboard automation (private registry: `pkg.nutjs.dev`) |
| `sharp` ^0.34.5 | Screenshot compression before API upload |
| `uiohook-napi` ^1.5.4 | Global input capture for route recording |
| `electron-store` ^8.2.0 | Encrypted local storage |
| `pdfjs-dist`, `mammoth`, `exceljs` | Document reading (PDF, DOCX, XLSX) |
| `pdfkit`, `docx` | Document generation |
| `@anthropic-ai/sdk` | Claude API (backend only) |
| `@supabase/supabase-js` | Database (backend only) |

---

## Build

```bash
npm start              # Dev
npm run build:mac      # macOS DMG (x64 + arm64) — requires swiftc for ax-helper
npm run build:win      # Windows NSIS — requires .NET 8 SDK for ax-helper-win.exe
npm run build:all      # Both — skips platform if binary missing
```

`ax-helper-win.exe` cannot be cross-compiled from Mac. Build on Windows with `npm run build:ax-win`, commit to `resources/`, then `npm run build:all` picks it up.

---

## Backend API Endpoints (Vercel)

```
POST /api/agent/poll              → returns next queued task for device
POST /api/agent/execute           → run task with Claude reasoning
POST /api/agent/route/save|run|list
POST /api/agent/scan-folder / scan-result
POST /api/agent/analyze-file
POST /api/agent/screen-learn / calibrate
POST /api/brain/mini-find         → vision: locate UI element in screenshot
POST /api/brain/mini-verify       → vision: verify UI state
POST /api/brain/perceive          → full semantic scene understanding
POST /api/brain/correct           → re-plan failed step
POST /api/brain/resolve-step      → Claude: find element via AX context
POST /api/brain/memory-save
POST /api/brain/dispatch
POST /api/brain/training-start
POST /api/brain/goals             → goal-driven planning (MiraPlanner)
POST /api/brain/knowledge-base    → MiraBrain config fetch
```
