import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MongoClient } from 'mongodb';

const dataDir = path.join(process.cwd(), 'data');
const dbFile = path.join(dataDir, 'events.json');

let db = null;
let events = {};
let saveTimer = null;

function persist() {
  if (db) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(dbFile, JSON.stringify(events), err => {
      if (err) console.error('Failed to persist data:', err.message);
    });
  }, 300);
}

function photoDoc(eventId, photo) {
  return { _id: photo.id, eventId, ...photo };
}

function photoFromDoc(doc) {
  const { _id, eventId, ...photo } = doc;
  return photo;
}

export async function initStore() {
  if (process.env.MONGODB_URI) {
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'weddingFaceFinder');
    await db.collection('photos').createIndex({ eventId: 1 });
    const metas = await db.collection('events').find().toArray();
    const photoDocs = await db.collection('photos').find().sort({ addedAt: 1 }).toArray();
    events = {};
    for (const meta of metas) {
      events[meta._id] = {
        id: meta._id,
        name: meta.name,
        adminKey: meta.adminKey,
        createdAt: meta.createdAt,
        photos: []
      };
    }
    for (const doc of photoDocs) {
      const event = events[doc.eventId];
      if (event) event.photos.push(photoFromDoc(doc));
    }
    console.log(`Storage: MongoDB connected, ${metas.length} events restored`);
    return;
  }
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(dbFile)) {
    try {
      events = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    } catch {
      events = {};
    }
  }
  console.log('Storage: local JSON file. Set MONGODB_URI for permanent cloud storage.');
}

export function uid(length = 12) {
  return crypto.randomBytes(24).toString('base64url').replace(/[-_]/g, '').slice(0, length);
}

export async function createEvent(name) {
  const event = {
    id: uid(10),
    adminKey: uid(24),
    name: String(name).trim().slice(0, 80),
    createdAt: new Date().toISOString(),
    photos: []
  };
  events[event.id] = event;
  if (db) {
    await db.collection('events').insertOne({
      _id: event.id,
      name: event.name,
      adminKey: event.adminKey,
      createdAt: event.createdAt
    });
  } else {
    persist();
  }
  return event;
}

export function getEvent(id) {
  return events[id] || null;
}

export async function addPhotos(event, photos) {
  event.photos.push(...photos);
  if (db) {
    if (photos.length) {
      await db.collection('photos').insertMany(photos.map(p => photoDoc(event.id, p)), { ordered: false });
    }
  } else {
    persist();
  }
}

export async function updatePhoto(event, photo) {
  if (db) {
    await db.collection('photos').updateOne(
      { _id: photo.id },
      { $set: { status: photo.status, descriptors: photo.descriptors } }
    );
  } else {
    persist();
  }
}

export async function removePhoto(event, photoId) {
  const index = event.photos.findIndex(p => p.id === photoId);
  if (index === -1) return null;
  const [photo] = event.photos.splice(index, 1);
  if (db) {
    await db.collection('photos').deleteOne({ _id: photoId });
  } else {
    persist();
  }
  return photo;
}
