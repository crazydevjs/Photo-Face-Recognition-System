const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';
const eventId = location.pathname.split('/').filter(Boolean).pop();
const adminKey = new URLSearchParams(location.search).get('key') || localStorage.getItem(`wff:key:${eventId}`);

const els = {
  title: document.getElementById('eventTitle'),
  statTotal: document.getElementById('statTotal'),
  statReady: document.getElementById('statReady'),
  statFaces: document.getElementById('statFaces'),
  statPending: document.getElementById('statPending'),
  guestLink: document.getElementById('guestLink'),
  copyLinkBtn: document.getElementById('copyLinkBtn'),
  openLinkBtn: document.getElementById('openLinkBtn'),
  qrImg: document.getElementById('qrImg'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  driveLink: document.getElementById('driveLink'),
  driveImportBtn: document.getElementById('driveImportBtn'),
  uploadProgress: document.getElementById('uploadProgress'),
  uploadFill: document.getElementById('uploadFill'),
  uploadLabel: document.getElementById('uploadLabel'),
  uploadPct: document.getElementById('uploadPct'),
  processBtn: document.getElementById('processBtn'),
  processFill: document.getElementById('processFill'),
  processLabel: document.getElementById('processLabel'),
  processPct: document.getElementById('processPct'),
  photoGrid: document.getElementById('photoGrid'),
  libraryHint: document.getElementById('libraryHint'),
  lightbox: document.getElementById('lightbox'),
  lbImg: document.getElementById('lbImg'),
  lbClose: document.getElementById('lbClose'),
  toast: document.getElementById('toast')
};

let photos = [];
let modelsReady = false;
let processing = false;
let stopRequested = false;

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function api(path, options = {}) {
  options.headers = Object.assign({ 'x-admin-key': adminKey }, options.headers || {});
  return fetch(path, options).then(async res => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  });
}

function updateStats() {
  const ready = photos.filter(p => p.status === 'done');
  const pending = photos.filter(p => p.status === 'pending');
  els.statTotal.textContent = photos.length;
  els.statReady.textContent = ready.length;
  els.statFaces.textContent = ready.reduce((sum, p) => sum + (p.faces || 0), 0);
  els.statPending.textContent = pending.length;
  els.libraryHint.textContent = photos.length
    ? `${photos.length} photos in this event`
    : 'No photos yet — add some above.';
}

function chipFor(photo) {
  if (photo.status === 'done') return `<span class="chip ok">✓ ${photo.faces} face${photo.faces === 1 ? '' : 's'}</span>`;
  if (photo.status === 'failed') return '<span class="chip fail">✕ failed</span>';
  return '<span class="chip wait">⏳ pending</span>';
}

function renderGrid() {
  els.photoGrid.innerHTML = photos
    .map(
      p => `
    <div class="tile" data-id="${p.id}">
      <img src="${p.src}" alt="" loading="lazy" />
      ${chipFor(p)}
    </div>`
    )
    .join('');
  updateStats();
}

function updateTile(photo) {
  const tile = els.photoGrid.querySelector(`.tile[data-id="${photo.id}"]`);
  if (!tile) return;
  const chip = tile.querySelector('.chip');
  if (chip) chip.outerHTML = chipFor(photo);
  updateStats();
}

async function loadEvent() {
  try {
    const data = await api(`/api/events/${eventId}/admin`);
    els.title.textContent = data.name;
    document.title = `${data.name} — Admin Dashboard`;
    photos = data.photos;
    renderGrid();
    const link = `${location.origin}/e/${eventId}`;
    els.guestLink.value = link;
    els.openLinkBtn.href = link;
    els.qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(link)}`;
  } catch (err) {
    els.title.textContent = 'Access Denied';
    showToast(err.message);
  }
}

async function ensureModels() {
  if (modelsReady) return;
  els.processLabel.textContent = 'Loading AI models…';
  if (faceapi.tf) {
    try {
      await faceapi.tf.setBackend('webgl');
      await faceapi.tf.ready();
    } catch {}
  }
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ]);
  modelsReady = true;
}

function loadImage(src, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => {
      img.src = '';
      reject(new Error('Image load timed out'));
    }, timeout);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Image failed to load'));
    };
    img.src = src;
  });
}

const detectorOptions = () => new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 });
const MIN_FACE_SIZE = 36;
const TILE_THRESHOLD = 1400;
const TILE_OVERLAP = 0.18;
const INDEX_CONCURRENCY = 4;

async function detectFaces(input) {
  return faceapi.detectAllFaces(input, detectorOptions()).withFaceLandmarks().withFaceDescriptors();
}

function boxIou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function makeTiles(width, height) {
  const longest = Math.max(width, height);
  const grid = longest > 2600 ? 3 : 2;
  const tiles = [];
  const tileW = Math.ceil(width / grid);
  const tileH = Math.ceil(height / grid);
  const padX = Math.round(tileW * TILE_OVERLAP);
  const padY = Math.round(tileH * TILE_OVERLAP);
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const x = Math.max(0, col * tileW - padX);
      const y = Math.max(0, row * tileH - padY);
      const w = Math.min(width - x, tileW + padX * 2);
      const h = Math.min(height - y, tileH + padY * 2);
      tiles.push({ x, y, w, h });
    }
  }
  return tiles;
}

async function extractDescriptors(img) {
  const found = [];
  const whole = await detectFaces(img);
  for (const d of whole) {
    const { x, y, width, height } = d.detection.box;
    found.push({ box: { x, y, width, height }, score: d.detection.score, descriptor: d.descriptor });
  }
  if (Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height) > TILE_THRESHOLD) {
    const tiles = makeTiles(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    for (const tile of tiles) {
      canvas.width = tile.w;
      canvas.height = tile.h;
      ctx.drawImage(img, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
      const dets = await detectFaces(canvas);
      for (const d of dets) {
        const { x, y, width, height } = d.detection.box;
        found.push({
          box: { x: x + tile.x, y: y + tile.y, width, height },
          score: d.detection.score,
          descriptor: d.descriptor
        });
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const face of found) {
    if (face.box.width < MIN_FACE_SIZE || face.box.height < MIN_FACE_SIZE) continue;
    if (kept.some(k => boxIou(k.box, face.box) > 0.4)) continue;
    kept.push(face);
  }
  return kept.map(face => Array.from(face.descriptor));
}

async function indexPhoto(photo, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (stopRequested) return;
    try {
      const separator = photo.src.includes('?') ? '&' : '?';
      const src = attempt > 1 ? `${photo.src}${separator}retry=${attempt}` : photo.src;
      const img = await loadImage(src, 60000);
      const descriptors = await extractDescriptors(img);
      const result = await api(`/api/events/${eventId}/photos/${photo.id}/descriptors`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptors })
      });
      photo.status = result.status;
      photo.faces = result.faces;
      return;
    } catch {
      if (attempt < attempts && !stopRequested) {
        await new Promise(resolve => setTimeout(resolve, attempt * 3000));
      }
    }
  }
  if (stopRequested) return;
  try {
    await api(`/api/events/${eventId}/photos/${photo.id}/descriptors`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed' })
    });
  } catch {}
  photo.status = 'failed';
}

async function processPhotos() {
  if (processing) {
    stopRequested = true;
    els.processBtn.textContent = 'Stopping…';
    return;
  }
  const queue = photos.filter(p => p.status === 'pending' || p.status === 'failed');
  if (!queue.length) {
    showToast('All photos are already indexed');
    return;
  }
  processing = true;
  stopRequested = false;
  els.processBtn.textContent = '⏸ Stop';
  try {
    await ensureModels();
    const total = queue.length;
    let done = 0;
    let cursor = 0;
    const worker = async () => {
      while (!stopRequested) {
        const index = cursor++;
        if (index >= total) return;
        const photo = queue[index];
        await indexPhoto(photo);
        done++;
        const pct = Math.round((done / total) * 100);
        els.processFill.style.width = `${pct}%`;
        els.processPct.textContent = `${done}/${total}`;
        els.processLabel.textContent = `Indexing… ${done} of ${total}`;
        updateTile(photo);
      }
    };
    await Promise.all(Array.from({ length: INDEX_CONCURRENCY }, worker));
    els.processLabel.textContent = stopRequested ? 'Paused — press Start to resume' : 'Indexing complete 🎉';
    if (!stopRequested) showToast('All photos indexed — guests can now find their photos!');
  } catch (err) {
    els.processLabel.textContent = 'Error loading AI models';
    showToast(err.message);
  } finally {
    processing = false;
    els.processBtn.textContent = '▶ Start Indexing';
  }
}

function uploadFiles(files) {
  const images = [...files].filter(f => f.type.startsWith('image/'));
  if (!images.length) return showToast('Please select image files');
  const formData = new FormData();
  images.forEach(f => formData.append('photos', f));
  els.uploadProgress.classList.remove('hidden');
  els.uploadLabel.textContent = `Uploading ${images.length} photo${images.length === 1 ? '' : 's'}…`;
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/events/${eventId}/photos`);
  xhr.setRequestHeader('x-admin-key', adminKey);
  xhr.upload.onprogress = e => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    els.uploadFill.style.width = `${pct}%`;
    els.uploadPct.textContent = `${pct}%`;
  };
  xhr.onload = () => {
    els.uploadProgress.classList.add('hidden');
    els.uploadFill.style.width = '0%';
    if (xhr.status >= 200 && xhr.status < 300) {
      const data = JSON.parse(xhr.responseText);
      photos.push(...data.added);
      renderGrid();
      showToast(`${data.added.length} photos uploaded — click Start Indexing`);
    } else {
      showToast('Upload failed, please try again');
    }
  };
  xhr.onerror = () => {
    els.uploadProgress.classList.add('hidden');
    showToast('Upload failed, please try again');
  };
  xhr.send(formData);
}

async function importFromDrive() {
  const link = els.driveLink.value.trim();
  if (!link) return showToast('Paste a Google Drive folder link first');
  els.driveImportBtn.disabled = true;
  els.driveImportBtn.innerHTML = '<span class="spinner"></span> Importing…';
  try {
    const data = await api(`/api/events/${eventId}/drive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link })
    });
    photos.push(...data.added);
    renderGrid();
    showToast(
      data.added.length
        ? `${data.added.length} photos imported from Drive — click Start Indexing`
        : 'No new photos found in that folder'
    );
  } catch (err) {
    showToast(err.message);
  } finally {
    els.driveImportBtn.disabled = false;
    els.driveImportBtn.textContent = 'Import from Drive 📥';
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-upload').classList.toggle('hidden', tab.dataset.tab !== 'upload');
    document.getElementById('tab-drive').classList.toggle('hidden', tab.dataset.tab !== 'drive');
  });
});

els.dropzone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => {
  uploadFiles(els.fileInput.files);
  els.fileInput.value = '';
});

['dragover', 'dragleave', 'drop'].forEach(type => {
  els.dropzone.addEventListener(type, e => {
    e.preventDefault();
    els.dropzone.classList.toggle('dragover', type === 'dragover');
    if (type === 'drop') uploadFiles(e.dataTransfer.files);
  });
});

els.driveImportBtn.addEventListener('click', importFromDrive);
els.processBtn.addEventListener('click', processPhotos);

els.copyLinkBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.guestLink.value);
  showToast('Guest link copied!');
});

els.photoGrid.addEventListener('click', e => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  els.lbImg.src = tile.querySelector('img').src;
  els.lightbox.classList.add('open');
});

els.lbClose.addEventListener('click', () => els.lightbox.classList.remove('open'));
els.lightbox.addEventListener('click', e => {
  if (e.target === els.lightbox) els.lightbox.classList.remove('open');
});

if (!adminKey) {
  els.title.textContent = 'Missing admin key';
  showToast('Open this page using your admin link');
} else {
  localStorage.setItem(`wff:key:${eventId}`, adminKey);
  loadEvent();
}
