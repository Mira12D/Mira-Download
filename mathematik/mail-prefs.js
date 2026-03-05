'use strict';

const fs   = require('fs');
const path = require('path');

let _path = null;

function prefsPath() {
  if (_path) return _path;
  try {
    const { app } = require('electron');
    _path = path.join(app.getPath('userData'), 'mira-prefs.json');
  } catch {
    _path = path.join(__dirname, '..', 'mira-prefs.json');
  }
  return _path;
}

function get(key) {
  try {
    const data = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
    return data[key] ?? null;
  } catch { return null; }
}

function set(key, value) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(prefsPath(), 'utf8')); } catch {}
  data[key] = value;
  fs.writeFileSync(prefsPath(), JSON.stringify(data, null, 2));
}

module.exports = { get, set };
