const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';
const eventId = location.pathname.split('/').filter(Boolean).pop();

const els = {
  title: document.getElementById('eventTitle'),
  meta: document.getElementById('eventMeta'),
  scanCard: document.getElementById('scanCard'),
  camFrame: document.getElementById('camFrame'),
  video: document.getElementById('video'),
  scanStatus: document.getElementById('scanStatus'),
  scanBtn: document.getElementById('scanBtn'),
  selfieBtn: document.getElementById('selfieBtn'),
  selfieInput: document.getElementById('selfieInput'),
  resultsCard: document.getElementById('resultsCard'),
  resultsSub: document.getElementById('resultsSub'),
  resultsGrid: document.getElementById('resultsGrid'),
  noResults: document.getElementById('noResults'),
  zipBtn: document.getElementById('zipBtn'),
  rescanBtn: document.getElementById('rescanBtn'),
  lightbox: document.getElementById('lightbox'),
  lbImg: document.getElementById('lbImg'),
  lbDownload: document.getElementById('lbDownload'),
  lbClose: document.getElementById('lbClose'),
  toast: document.getElementById('toast')
};

let stream = null;
let modelsReady = false;
let matchedPhotos = [];

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function setStatus(message, type = '') {
  els.scanStatus.textContent = message;
  els.scanStatus.className = `status-msg ${type}`;
}

async function loadEvent() {
  try {
    const res = await fetch(`/api/events/${eventId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Event not found');
    els.title.textContent = data.name;
    document.title = `${data.name} — Find Your Photos`;
    els.meta.textContent = `${data.readyPhotos} photos ready to search`;
  } catch (err) {
    els.title.textContent = 'Event Not Found';
    setStatus(err.message, 'error');
    els.scanBtn.disabled = true;
    els.selfieBtn.disabled = true;
  }
}

async function ensureModels() {
  if (modelsReady) return;
  setStatus('Loading AI models…');
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ]);
  modelsReady = true;
}

async function startCamera() {
  if (stream) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
      audio: false
    });
    els.video.srcObject = stream;
    await els.video.play();
    setStatus('Camera ready — tap Scan My Face');
    return true;
  } catch {
    setStatus('Camera unavailable — upload a selfie instead', 'error');
    return false;
  }
}

function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach(track => track.stop());
  stream = null;
  els.video.srcObject = null;
}

async function detectDescriptor(input) {
  const detection = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection ? Array.from(detection.descriptor) : null;
}

function captureFrame() {
  const canvas = document.createElement('canvas');
  canvas.width = els.video.videoWidth;
  canvas.height = els.video.videoHeight;
  canvas.getContext('2d').drawImage(els.video, 0, 0);
  return canvas;
}

async function scanFromCamera() {
  els.scanBtn.disabled = true;
  els.selfieBtn.disabled = true;
  try {
    await ensureModels();
    if (!(await startCamera())) return;
    els.camFrame.classList.add('scanning');
    setStatus('Scanning… hold still and look at the camera');
    const descriptors = [];
    for (let attempt = 0; attempt < 6 && descriptors.length < 3; attempt++) {
      const descriptor = await detectDescriptor(captureFrame());
      if (descriptor) descriptors.push(descriptor);
      await new Promise(r => setTimeout(r, 350));
    }
    els.camFrame.classList.remove('scanning');
    if (!descriptors.length) {
      setStatus('No face detected — try better lighting', 'error');
      return;
    }
    await findMatches(descriptors);
  } catch (err) {
    els.camFrame.classList.remove('scanning');
    setStatus(err.message, 'error');
  } finally {
    els.scanBtn.disabled = false;
    els.selfieBtn.disabled = false;
  }
}

async function scanFromSelfie(file) {
  els.scanBtn.disabled = true;
  els.selfieBtn.disabled = true;
  try {
    await ensureModels();
    setStatus('Analyzing your selfie…');
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not read that image'));
      image.src = URL.createObjectURL(file);
    });
    const descriptor = await detectDescriptor(img);
    URL.revokeObjectURL(img.src);
    if (!descriptor) {
      setStatus('No face found in that selfie — try a clearer one', 'error');
      return;
    }
    await findMatches([descriptor]);
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    els.scanBtn.disabled = false;
    els.selfieBtn.disabled = false;
  }
}

async function findMatches(descriptors) {
  setStatus('Searching all event photos…');
  const res = await fetch(`/api/events/${eventId}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ descriptors })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Search failed');
  matchedPhotos = data.matches;
  stopCamera();
  setStatus(`Found you in ${data.matches.length} of ${data.searched} photos`, 'success');
  renderResults(data.searched);
}

function renderResults(searched) {
  els.scanCard.classList.add('hidden');
  els.resultsCard.classList.remove('hidden');
  els.resultsSub.textContent = `You appear in ${matchedPhotos.length} of ${searched} photos`;
  const hasMatches = matchedPhotos.length > 0;
  els.noResults.classList.toggle('hidden', hasMatches);
  els.zipBtn.classList.toggle('hidden', !hasMatches);
  els.resultsGrid.innerHTML = matchedPhotos
    .map(
      (p, i) => `
    <div class="tile" data-index="${i}">
      <img src="${p.src}" alt="${p.name}" loading="lazy" />
      <span class="conf">${p.confidence}% match</span>
      <a class="dl" href="${p.download}" title="Download" onclick="event.stopPropagation()">⬇</a>
    </div>`
    )
    .join('');
  els.resultsCard.scrollIntoView({ behavior: 'smooth' });
}

async function downloadZip() {
  els.zipBtn.disabled = true;
  els.zipBtn.innerHTML = '<span class="spinner"></span> Preparing ZIP…';
  try {
    const res = await fetch(`/api/events/${eventId}/zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: matchedPhotos.map(p => p.id) })
    });
    if (!res.ok) throw new Error('ZIP download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-wedding-photos.zip';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message);
  } finally {
    els.zipBtn.disabled = false;
    els.zipBtn.textContent = '⬇ Download All (ZIP)';
  }
}

els.scanBtn.addEventListener('click', scanFromCamera);
els.selfieBtn.addEventListener('click', () => els.selfieInput.click());
els.selfieInput.addEventListener('change', () => {
  if (els.selfieInput.files[0]) scanFromSelfie(els.selfieInput.files[0]);
  els.selfieInput.value = '';
});

els.rescanBtn.addEventListener('click', () => {
  els.resultsCard.classList.add('hidden');
  els.scanCard.classList.remove('hidden');
  setStatus('Allow camera access to begin');
  startCamera();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

els.zipBtn.addEventListener('click', downloadZip);

els.resultsGrid.addEventListener('click', e => {
  if (e.target.closest('.dl')) return;
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const photo = matchedPhotos[Number(tile.dataset.index)];
  els.lbImg.src = photo.src;
  els.lbDownload.href = photo.download;
  els.lightbox.classList.add('open');
});

els.lbClose.addEventListener('click', () => els.lightbox.classList.remove('open'));
els.lightbox.addEventListener('click', e => {
  if (e.target === els.lightbox) els.lightbox.classList.remove('open');
});

loadEvent();
startCamera();
