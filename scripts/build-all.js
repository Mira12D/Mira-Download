#!/usr/bin/env node
'use strict';

/**
 * scripts/build-all.js
 *
 * Unified build orchestrator for MIRA Agent.
 *
 * What it does:
 *   1. Compiles ax-helper.swift → resources/ax-helper          (Mac only, needs swiftc)
 *   2. Compiles ax-helper-win  → resources/ax-helper-win.exe   (Windows only, needs dotnet)
 *   3. Detects pre-built binaries committed from other platforms
 *   4. Runs electron-builder with only the targets whose binaries are present
 *
 * Usage:
 *   node scripts/build-all.js          # smart: builds available targets
 *   node scripts/build-all.js --mac    # force Mac target only
 *   node scripts/build-all.js --win    # force Windows target only
 */

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT         = path.join(__dirname, '..');
const RESOURCES    = path.join(ROOT, 'resources');
const AX_MAC       = path.join(RESOURCES, 'ax-helper');
const AX_WIN       = path.join(RESOURCES, 'ax-helper-win.ps1');
const PLATFORM     = process.platform;           // 'darwin' | 'win32' | 'linux'
const FORCE_MAC    = process.argv.includes('--mac');
const FORCE_WIN    = process.argv.includes('--win');
const FORCE_ANY    = FORCE_MAC || FORCE_WIN;

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(msg)   { console.log(`  \u2713  ${msg}`); }
function info(msg) { console.log(`  \u2139  ${msg}`); }
function warn(msg) { console.log(`  \u26a0  ${msg}`); }
function fail(msg) { console.error(`  \u2717  ${msg}`); }
function head(msg) { console.log(`\n\u25b6 ${msg}`); }

function toolExists(cmd) {
  try { execSync(`${cmd} --version`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}

// ── Step 1: Compile Mac binary ────────────────────────────────────────────────

let macBuilt = false;

function buildMacBinary() {
  head('Step 1: ax-helper (Swift / macOS)');

  if (PLATFORM !== 'darwin') {
    info('Not on macOS — skipping Swift compilation.');
    return;
  }

  if (!toolExists('swiftc')) {
    warn('swiftc not found — install Xcode Command Line Tools: xcode-select --install');
    return;
  }

  console.log('     Compiling ax-helper.swift...');
  try {
    run('swiftc ax-helper.swift -O -o resources/ax-helper && chmod +x resources/ax-helper');
    ok(`resources/ax-helper built (${fileSizeKB(AX_MAC)} KB)`);
    macBuilt = true;
  } catch {
    fail('ax-helper.swift compilation failed.');
  }
}

// ── Step 2: Compile Windows binary ───────────────────────────────────────────

let winBuilt = false;

function buildWinBinary() {
  head('Step 2: ax-helper-win.ps1 (PowerShell / no compilation needed)');
  // PowerShell 5.1 is built into every Windows 10/11 machine.
  // The .ps1 lives in resources/ as a plain text file — just check it exists.
  if (fs.existsSync(AX_WIN)) {
    ok(`resources/ax-helper-win.ps1 found (${fileSizeKB(AX_WIN)} KB) — no compilation required`);
    winBuilt = true;
  } else {
    warn('resources/ax-helper-win.ps1 missing — Windows target will be skipped');
  }
}

// ── Step 3: Detect pre-built binaries ─────────────────────────────────────────

function detectPrebuilt() {
  head('Step 3: Checking resources/');

  if (!macBuilt && fs.existsSync(AX_MAC)) {
    ok(`ax-helper found (${fileSizeKB(AX_MAC)} KB) — using pre-built binary`);
    macBuilt = true;
  } else if (!macBuilt) {
    warn('resources/ax-helper missing — Mac target will be skipped');
  }

  if (!winBuilt && fs.existsSync(AX_WIN)) {
    ok(`ax-helper-win.ps1 found (${fileSizeKB(AX_WIN)} KB) — using PowerShell helper`);
    winBuilt = true;
  } else if (!winBuilt) {
    warn('resources/ax-helper-win.ps1 missing — Windows target will be skipped');
  }
}

// ── Step 4: Run electron-builder ─────────────────────────────────────────────

function runElectronBuilder() {
  head('Step 4: electron-builder');

  // Determine which targets to pass
  let targets = [];

  if (FORCE_ANY) {
    // Explicit flags override
    if (FORCE_MAC) {
      if (!macBuilt) { fail('--mac requested but resources/ax-helper is missing. Aborting.'); process.exit(1); }
      targets.push('--mac');
    }
    if (FORCE_WIN) {
      if (!winBuilt) { fail('--win requested but resources/ax-helper-win.ps1 is missing. Aborting.'); process.exit(1); }
      targets.push('--win');
    }
  } else {
    // Auto-detect from available binaries
    if (macBuilt) targets.push('--mac');
    if (winBuilt) targets.push('--win');
  }

  if (targets.length === 0) {
    fail('No binaries available — cannot build any target.');
    console.log('');
    console.log('  To build for Mac:     npm run build:ax   (then re-run build:all)');
    console.log('  To build for Windows: npm run build:ax-win  (on Windows, then commit)');
    process.exit(1);
  }

  console.log(`     Targets: ${targets.join(' ')}`);
  const eb = path.join(ROOT, 'node_modules', '.bin', 'electron-builder');
  const result = spawnSync(eb, targets, { cwd: ROOT, stdio: 'inherit', shell: false });

  if (result.error) {
    fail(`electron-builder failed: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function fileSizeKB(p) {
  try { return Math.round(fs.statSync(p).size / 1024); }
  catch { return '?'; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════╗');
console.log('║      MIRA Agent — Build All          ║');
console.log(`║      Platform: ${PLATFORM.padEnd(22)}║`);
console.log('╚══════════════════════════════════════╝');

fs.mkdirSync(RESOURCES, { recursive: true });

buildMacBinary();
buildWinBinary();
detectPrebuilt();
runElectronBuilder();
