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

export async function listImagesInFolder(folderId) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (apiKey) {
    try {
      return await listViaApi(folderId, apiKey);
    } catch (err) {
      console.error('Drive API failed, falling back to public scan:', err.message);
    }
  }
  return listViaEmbed(folderId);
}

async function listViaApi(folderId, apiKey) {
  const files = [];
  let pageToken = '';
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Drive API responded with ${res.status}`);
    const data = await res.json();
    for (const file of data.files || []) {
      if (file.mimeType && file.mimeType.startsWith('image/')) {
        files.push({ id: file.id, name: file.name });
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function listViaEmbed(folderId) {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  if (!res.ok) {
    throw new Error('Folder is not accessible. Make sure sharing is set to "Anyone with the link".');
  }
  const html = await res.text();
  const files = [];
  const seen = new Set();
  const patterns = [
    /file\/d\/([A-Za-z0-9_-]{10,})[\s\S]{0,600}?flip-entry-title">([^<]+)</g,
    /id="entry-([A-Za-z0-9_-]{10,})"[\s\S]{0,600}?flip-entry-title">([^<]+)</g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const id = match[1];
      const name = decodeEntities(match[2].trim());
      if (seen.has(id)) continue;
      seen.add(id);
      if (IMAGE_EXT.test(name)) files.push({ id, name });
    }
    if (files.length) break;
  }
  return files;
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
    `https://lh3.googleusercontent.com/d/${fileId}=s1600`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
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
