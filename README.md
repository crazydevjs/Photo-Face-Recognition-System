# 💍 Wedding Face Finder

AI-powered wedding photo delivery system. The photographer/host uploads all event photos (or pastes a public Google Drive folder link), shares one guest link, and every guest scans their face to instantly see and download only the photos they appear in.

## Features

- **Two photo sources** — direct multi-upload (drag & drop) or import an entire public Google Drive folder by pasting its link
- **AI face recognition** — face-api.js (TensorFlow.js) generates 128-dimension face embeddings; matching runs server-side with euclidean distance
- **Guest magic link + QR code** — auto-generated per event, ready to print on wedding cards
- **Live camera scan or selfie upload** — guests find their photos in seconds
- **Single photo download + Download All as ZIP**
- **Privacy first** — face scans are processed in the browser; only numeric embeddings are stored, never face images
- **Fully responsive** — works on phones, tablets, and desktops
- **Zero native dependencies** — pure Node.js, deploys anywhere

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 18+, Express |
| AI | @vladmandic/face-api (TensorFlow.js) via CDN |
| Uploads | Multer |
| ZIP streaming | Archiver |
| Storage | JSON file store + local disk |
| Drive import | Google Drive public folder scan (optional Drive API key) |

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:3000

## How It Works

1. **Create an event** on the home page — you get a private admin dashboard
2. **Add photos** — upload directly or paste a Google Drive folder link (sharing must be "Anyone with the link")
3. **Start Indexing** — the dashboard scans every photo for faces using AI (runs in your browser, progress is saved)
4. **Share the guest link / QR code**
5. Guests open the link, **scan their face**, and instantly get a gallery of their photos with download buttons

## Configuration

Copy `.env.example` to `.env`:

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default 3000) |
| `GOOGLE_API_KEY` | No | Google Drive API key for more reliable folder imports of very large folders |

Without an API key, public Drive folders are scanned via the embedded folder view. For folders with 1000+ photos, create a free API key at https://console.cloud.google.com (enable "Google Drive API") and set `GOOGLE_API_KEY`.

## Deployment

Works on any Node.js host. Camera access requires HTTPS in production (all hosts below provide it automatically).

### Render / Railway

1. Push this folder to a GitHub repo
2. Create a new Web Service from the repo
3. Build command: `npm install` — Start command: `npm start`
4. Add a persistent disk mounted at the project directory (or at `/data` + `/uploads`) so events and uploads survive restarts

### VPS (Ubuntu)

```bash
git clone <your-repo>
cd <your-repo>
npm install
npm start
```

Put nginx + certbot in front for HTTPS, or use `pm2 start server/index.js` to keep it running.

## Project Structure

```
├── server/
│   ├── index.js        Express app, REST API, matching, ZIP, Drive proxy
│   ├── store.js        JSON persistence layer
│   └── drive.js        Google Drive folder listing + URL builders
├── public/
│   ├── index.html      Landing page (create event)
│   ├── admin.html      Admin dashboard (upload, Drive import, AI indexing)
│   ├── event.html      Guest portal (face scan, results, downloads)
│   ├── css/style.css
│   └── js/
│       ├── main.js
│       ├── admin.js
│       └── guest.js
├── uploads/            Uploaded photos (auto-created, gitignored)
└── data/               events.json (auto-created, gitignored)
```
