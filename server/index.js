import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { createEvent, getEvent, saveEvents, uid } from './store.js';
import { extractFolderId, listImagesInFolder, driveImageUrls, driveDownloadUrls } from './drive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const uploadsDir = path.join(root, 'uploads');
const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD) || 0.5;
const PORT = process.env.PORT || 3000;

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', immutable: true }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsDir, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uid(14)}${path.extname(file.originalname).toLowerCase() || '.jpg'}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024, files: 500 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

function requireEvent(req, res, next) {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  req.event = event;
  next();
}

function requireAdmin(req, res, next) {
  requireEvent(req, res, () => {
    const key = req.headers['x-admin-key'] || req.query.key;
    if (key !== req.event.adminKey) {
      return res.status(403).json({ error: 'Invalid admin key' });
    }
    next();
  });
}

function photoSrc(event, photo) {
  if (photo.type === 'drive') return `/api/drive/${photo.driveId}/image`;
  return `/uploads/${event.id}/${photo.file}`;
}

function photoView(event, photo, includeStatus = false) {
  const base = {
    id: photo.id,
    name: photo.name,
    src: photoSrc(event, photo),
    download: `/api/events/${event.id}/photos/${photo.id}/download`
  };
  if (includeStatus) {
    base.status = photo.status;
    base.faces = photo.descriptors.length;
    base.type = photo.type;
  }
  return base;
}

function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function isDescriptor(value) {
  return Array.isArray(value) && value.length === 128 && value.every(n => typeof n === 'number' && Number.isFinite(n));
}

async function fetchFirstOk(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      const type = res.headers.get('content-type') || '';
      if (res.ok && !type.includes('text/html')) return res;
    } catch {}
  }
  return null;
}

app.post('/api/events', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Event name is required' });
  const event = createEvent(name);
  res.json({ id: event.id, name: event.name, adminKey: event.adminKey });
});

app.get('/api/events/:id', requireEvent, (req, res) => {
  const photos = req.event.photos;
  res.json({
    id: req.event.id,
    name: req.event.name,
    totalPhotos: photos.length,
    readyPhotos: photos.filter(p => p.status === 'done').length
  });
});

app.get('/api/events/:id/admin', requireAdmin, (req, res) => {
  res.json({
    id: req.event.id,
    name: req.event.name,
    createdAt: req.event.createdAt,
    photos: req.event.photos.map(p => photoView(req.event, p, true))
  });
});

app.post('/api/events/:id/photos', requireAdmin, upload.array('photos', 500), (req, res) => {
  const files = req.files || [];
  const added = files.map(file => {
    const photo = {
      id: uid(12),
      type: 'upload',
      name: file.originalname,
      file: file.filename,
      status: 'pending',
      descriptors: [],
      addedAt: new Date().toISOString()
    };
    req.event.photos.push(photo);
    return photoView(req.event, photo, true);
  });
  saveEvents();
  res.json({ added });
});

app.post('/api/events/:id/drive', requireAdmin, async (req, res) => {
  const folderId = extractFolderId(req.body.link);
  if (!folderId) return res.status(400).json({ error: 'Invalid Google Drive folder link' });
  try {
    const files = await listImagesInFolder(folderId);
    if (!files.length) {
      return res.status(404).json({
        error: 'No images found. Make sure the folder is shared as "Anyone with the link" and contains photos.'
      });
    }
    const existing = new Set(req.event.photos.filter(p => p.driveId).map(p => p.driveId));
    const added = [];
    for (const file of files) {
      if (existing.has(file.id)) continue;
      const photo = {
        id: uid(12),
        type: 'drive',
        name: file.name,
        driveId: file.id,
        status: 'pending',
        descriptors: [],
        addedAt: new Date().toISOString()
      };
      req.event.photos.push(photo);
      added.push(photoView(req.event, photo, true));
    }
    saveEvents();
    res.json({ added, foundInFolder: files.length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.put('/api/events/:id/photos/:photoId/descriptors', requireAdmin, (req, res) => {
  const photo = req.event.photos.find(p => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  if (req.body.status === 'failed') {
    photo.status = 'failed';
    photo.descriptors = [];
  } else {
    const descriptors = req.body.descriptors;
    if (!Array.isArray(descriptors) || !descriptors.every(isDescriptor)) {
      return res.status(400).json({ error: 'Invalid descriptors payload' });
    }
    photo.descriptors = descriptors;
    photo.status = 'done';
  }
  saveEvents();
  res.json({ id: photo.id, status: photo.status, faces: photo.descriptors.length });
});

app.delete('/api/events/:id/photos/:photoId', requireAdmin, (req, res) => {
  const index = req.event.photos.findIndex(p => p.id === req.params.photoId);
  if (index === -1) return res.status(404).json({ error: 'Photo not found' });
  const [photo] = req.event.photos.splice(index, 1);
  if (photo.type === 'upload') {
    fs.unlink(path.join(uploadsDir, req.event.id, photo.file), () => {});
  }
  saveEvents();
  res.json({ removed: photo.id });
});

app.post('/api/events/:id/match', requireEvent, (req, res) => {
  const probes = req.body.descriptors;
  if (!Array.isArray(probes) || !probes.length || !probes.every(isDescriptor)) {
    return res.status(400).json({ error: 'Invalid face data' });
  }
  const matches = [];
  let searched = 0;
  for (const photo of req.event.photos) {
    if (photo.status !== 'done' || !photo.descriptors.length) continue;
    searched++;
    let best = Infinity;
    for (const descriptor of photo.descriptors) {
      for (const probe of probes) {
        const distance = euclidean(descriptor, probe);
        if (distance < best) best = distance;
      }
    }
    if (best <= MATCH_THRESHOLD) {
      matches.push({ ...photoView(req.event, photo), confidence: Math.round((1 - best) * 100) });
    }
  }
  matches.sort((a, b) => b.confidence - a.confidence);
  res.json({ matches, searched });
});

app.get('/api/events/:id/photos/:photoId/download', requireEvent, async (req, res) => {
  const photo = req.event.photos.find(p => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const safeName = photo.name.replace(/[^\w.\- ]/g, '_') || `photo-${photo.id}.jpg`;
  if (photo.type === 'upload') {
    return res.download(path.join(uploadsDir, req.event.id, photo.file), safeName);
  }
  const remote = await fetchFirstOk(driveDownloadUrls(photo.driveId));
  if (!remote) return res.status(502).json({ error: 'Could not fetch photo from Google Drive' });
  res.setHeader('Content-Type', remote.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  Readable.fromWeb(remote.body).pipe(res);
});

app.post('/api/events/:id/zip', requireEvent, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 1000) : [];
  const photos = req.event.photos.filter(p => ids.includes(p.id));
  if (!photos.length) return res.status(400).json({ error: 'No photos selected' });
  const zipName = `${req.event.name.replace(/[^\w\- ]/g, '_') || 'photos'}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', () => res.end());
  archive.pipe(res);
  const usedNames = new Set();
  for (const photo of photos) {
    let name = photo.name.replace(/[^\w.\- ]/g, '_') || `${photo.id}.jpg`;
    if (usedNames.has(name)) name = `${photo.id}-${name}`;
    usedNames.add(name);
    if (photo.type === 'upload') {
      const filePath = path.join(uploadsDir, req.event.id, photo.file);
      if (fs.existsSync(filePath)) archive.file(filePath, { name });
    } else {
      const remote = await fetchFirstOk(driveDownloadUrls(photo.driveId));
      if (remote) archive.append(Buffer.from(await remote.arrayBuffer()), { name });
    }
  }
  archive.finalize();
});

app.get('/api/drive/:fileId/image', async (req, res) => {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(req.params.fileId)) {
    return res.status(400).json({ error: 'Invalid file id' });
  }
  const remote = await fetchFirstOk(driveImageUrls(req.params.fileId));
  if (!remote) return res.status(502).json({ error: 'Could not load image from Google Drive' });
  res.setHeader('Content-Type', remote.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  Readable.fromWeb(remote.body).pipe(res);
});

app.get('/admin/:id', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/e/:id', (req, res) => res.sendFile(path.join(publicDir, 'event.html')));
app.get('/health', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`Wedding Face Finder running on http://localhost:${PORT}`);
});
