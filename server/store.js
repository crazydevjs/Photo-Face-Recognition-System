import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const dataDir = path.join(process.cwd(), 'data');
const dbFile = path.join(dataDir, 'events.json');

let events = {};
let saveTimer = null;

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

if (fs.existsSync(dbFile)) {
  try {
    events = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch {
    events = {};
  }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(dbFile, JSON.stringify(events), err => {
      if (err) console.error('Failed to persist data:', err.message);
    });
  }, 300);
}

export function uid(length = 12) {
  return crypto.randomBytes(24).toString('base64url').replace(/[-_]/g, '').slice(0, length);
}

export function createEvent(name) {
  const event = {
    id: uid(10),
    adminKey: uid(24),
    name: String(name).trim().slice(0, 80),
    createdAt: new Date().toISOString(),
    photos: []
  };
  events[event.id] = event;
  persist();
  return event;
}

export function getEvent(id) {
  return events[id] || null;
}

export function saveEvents() {
  persist();
}
