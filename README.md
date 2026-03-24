# Beamit - Gigabit P2P File Sharing Engine 🚀

A hyper-performance, WebRTC-powered Peer-to-Peer file sharing application built to transfer data instantly across devices with zero size limits, zero third-party storage, and absolute End-to-End Encryption. 

## ✨ Key Features

- **No Size Limits (TB-Scale Streams)**: Unlike standard web applications that load files into RAM and crash, Beamit utilizes the **Origin Private File System (OPFS)** and `FileSystemWritableFileStream` to stream data directly to disk. Send 10GB, 100GB, or even 1TB files without your browser ever breaking a sweat.
- **Absolute Bandwidth Saturation**: The internal `RTCDataChannel` flow control is tuned to an aggressive **16MB High-Watermark** and **256KB Chunks**. This totally eradicates typical "sawtooth" network dropping, forcing the browser's TCP/UDP sockets to keep your network card permanently saturated at Gigabit speeds.
- **End-to-End Encrypted (DTLS)**: All file data is transmitted over native WebRTC peer-to-peer data channels. The metadata WebSocket server *never* sees, touches, or stores your files. Your transfers are cryptographically secured using DTLS cipher suites by default.
- **Mobile Data & Firewall Traversal (TURN)**: Strictly configured Symmetric NAT arrays (like cellular 5G networks and enterprise firewalls) typically block peer-to-peer connections. Beamit injects dynamic `metered.ca` TCP/UDP TURN Relays to automatically punch holes through aggressive firewalls ensuring the tunnel *always* connects.
- **Global Drop Matrix**: Outfitted with native Window-level drag intercepts. Instead of painstakingly dragging files into tiny specific user boxes, simply drop entire nested directory trees anywhere onto the application screen to instantly beam them to *every connected peer concurrently*.
- **Cyberpunk Theming Engine**: Features a persistent Dark/Light mode React design system using dynamically injected CSS Variable tokens and `localStorage` to deliver a stunning neon-grid aesthetic. 

## 🛠 Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Framer Motion
- **Networking**: WebRTC (RTCPeerConnection, RTCDataChannel), STUN / TURN relays
- **Storage**: Origin Private File System (`navigator.storage.getDirectory`)
- **Backend / Signaling**: Node.js, `ws` (WebSockets) for UDP hole-punch handshakes

## 🚀 Production Deployment (Render)

Beamit is fundamentally designed to be completely zero-config for Cloud Platforms like **Render**.

1. Connect this GitHub Repository to your Render Dashboard as a **Web Service**.
2. **Build Command**: `npm run build` *(The backend package.json automatically chains the Frontend Vite compilation!)*
3. **Start Command**: `npm start` *(Initiates the `ws` signaling server on Port 8080 and statically serves the compiled React application).*

That's it! Your WebRTC metadata signaling server and frontend will instantly go live globally.

## 💻 Local Development

1. Clone the repository and install the backend modules:
   ```bash
   cd backend
   npm install
   ```
2. Trigger the automated full-stack build pipeline:
   ```bash
   npm run build
   ```
3. Start the application:
   ```bash
   npm start
   ```

*Note: For testing across devices on separate networks locally, use a tunnel like `npx localtunnel --port 8080` to expose your development signaling server to the public web.*
