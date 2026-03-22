# Project Overview

A WebRTC peer-to-peer file sharing system. Users create or join rooms and transfer files directly between browsers — no server storage, no file size limits.

## Architecture

- **Frontend**: React + TypeScript + Vite + Tailwind CSS (port 5000 in dev)
- **Backend**: Node.js WebSocket signaling server (port 8080 in dev, `process.env.PORT` in production)

## Project Structure

```
/
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Home.tsx        — Landing page
│   │   │   ├── CreateRoom.tsx  — Room creation form
│   │   │   ├── Host.tsx        — Host view: manages members, file send/receive, chat
│   │   │   ├── Join.tsx        — Join view: peer connections, file send/receive, chat
│   │   │   ├── Layout.tsx      — Header + Footer wrapper
│   │   │   ├── Header.tsx
│   │   │   ├── Footer.tsx
│   │   │   └── Toggleable.tsx  — Click to toggle username/userId display
│   │   └── utils/
│   │       ├── wsUrl.ts        — Dynamic WebSocket URL (env var or auto-detect from host)
│   │       └── fileTransfer.ts — Streaming file send with 64KB chunks + buffer backpressure
│   ├── vite.config.ts          — host: 0.0.0.0, port: 5000, allowedHosts: true
│   └── .env                    — VITE_SOCKET_URL=ws://localhost:8080
└── backend/
    └── src/
        └── index.js            — WebSocket signaling + static file serving for production
```

## Key Improvements Made

1. **Deployment-ready**: Backend uses `process.env.PORT || 8080`, binds to `0.0.0.0`, serves frontend `dist/` in production
2. **Dynamic WS URL**: Frontend detects `wss://` vs `ws://` automatically; falls back to env var in dev
3. **Streaming file transfer**: 64KB chunks via `file.slice().arrayBuffer()`, buffer backpressure (`bufferedAmount > 8MB → wait`)
4. **File metadata**: Sends `{ type: "file-meta", name, path, size, totalChunks }` before chunks; `{ type: "EOF" }` after
5. **Folder upload**: `webkitdirectory` input; preserves `webkitRelativePath` in metadata
6. **Drag & drop**: Drop files onto any peer card to send instantly
7. **Progress bars**: Per-transfer send/receive progress with byte counters
8. **Multi-STUN**: Two Google STUN servers for better NAT traversal
9. **Modern UI**: Rounded cards, gradient backgrounds, responsive grid layout

## Running the App

**Frontend** (dev, port 5000):
```bash
cd frontend && npm run dev
```

**Backend** (dev, port 8080):
```bash
cd backend && npm start
```

**Production** (single port):
```bash
cd frontend && npm run build
cd backend && PORT=5000 npm start
```

## Environment Variables

- `VITE_SOCKET_URL` — Dev WS URL (default: `ws://localhost:8080`); omit in production for auto-detect
- `PORT` — Backend listen port (default: `8080`)

## Workflows

- `Start application` — Frontend Vite dev server on port 5000 (webview)
- `Backend` — WebSocket signaling server on port 8080 (console)

## Deployment

- Type: VM (stateful WebSocket server — must always be running)
- Build: `cd frontend && npm install && npm run build`
- Run: Backend serves both WebSocket and built frontend static files
