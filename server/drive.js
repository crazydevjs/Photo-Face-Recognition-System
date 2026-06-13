const IMAGE_EXT = /\.(jpe?g|png|webp|bmp|gif|heic|heif)$/i;

export function extractFolderId(link) {
  const text = String(link || '');
  const byPath = text.match(/folders\/([A-Za-z0-9_-]{10,})/);
  if (byPath) return byPath[1];
  const byQuery = text.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (byQuery) return byQuery[1];
  const bare = text.trim().match(/^([A-Za-z0-9_-]{20,})$/);
  return bare ? bare[1] : null;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_FOLDERS = 500;

export async function listImagesInFolder(folderId) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const files = [];
  const seenFiles = new Set();
  const visited = new Set();
  const queue = [folderId];
  let rootOk = false;
  while (queue.length && visited.size < MAX_FOLDERS) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    let result;
    try {
      result = apiKey ? await scanViaApi(current, apiKey) : await scanViaEmbed(current);
    } catch (err) {
      if (current === folderId && apiKey) {
        try {
          result = await scanViaEmbed(current);
        } catch (embedErr) {
          throw embedErr;
        }
      } else if (current === folderId) {
        throw err;
      } else {
        continue;
      }
    }
    rootOk = true;
    for (const image of result.images) {
      if (seenFiles.has(image.id)) continue;
      seenFiles.add(image.id);
      files.push(image);
    }
    for (const sub of result.folders) {
      if (!visited.has(sub)) queue.push(sub);
    }
  }
  if (!rootOk) {
    throw new Error('Folder is not accessible. Make sure sharing is set to "Anyone with the link".');
  }
  return files;
}

async function scanViaApi(folderId, apiKey) {
  const images = [];
  const folders = [];
  let pageToken = '';
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Drive API responded with ${res.status}`);
    const data = await res.json();
    for (const file of data.files || []) {
      if (file.mimeType === FOLDER_MIME) {
        folders.push(file.id);
      } else if (file.mimeType && file.mimeType.startsWith('image/')) {
        images.push({ id: file.id, name: file.name });
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return { images, folders };
}

async function scanViaEmbed(folderId) {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#grid`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  if (!res.ok) {
    throw new Error('Folder is not accessible. Make sure sharing is set to "Anyone with the link".');
  }
  const html = await res.text();
  const images = [];
  const fileIds = new Set();
  const filePattern = /file\/d\/([A-Za-z0-9_-]{10,})[\s\S]{0,800}?flip-entry-title">([^<]+)</g;
  let match;
  while ((match = filePattern.exec(html))) {
    const id = match[1];
    if (fileIds.has(id)) continue;
    fileIds.add(id);
    const name = decodeEntities(match[2].trim());
    if (IMAGE_EXT.test(name)) images.push({ id, name });
  }
  const folders = [];
  const folderSeen = new Set();
  const entryPattern = /id="entry-([A-Za-z0-9_-]{10,})"/g;
  while ((match = entryPattern.exec(html))) {
    const id = match[1];
    if (id === folderId || fileIds.has(id) || folderSeen.has(id)) continue;
    folderSeen.add(id);
    folders.push(id);
  }
  return { images, folders };
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function driveImageUrls(fileId) {
  return [
    `https://lh3.googleusercontent.com/d/${fileId}=s2048`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w2048`,
    `https://drive.usercontent.google.com/download?id=${fileId}&export=view`
  ];
}

export function driveDownloadUrls(fileId) {
  return [
    `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
    `https://lh3.googleusercontent.com/d/${fileId}=s0`
  ];
}
