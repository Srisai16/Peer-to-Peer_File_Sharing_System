import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuid } from "uuid";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const FRONTEND_DIST = path.join(__dirname, "../../frontend/dist");
const HOST_GRACE_MS = 90_000;

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  if (!fs.existsSync(FRONTEND_DIST)) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WebSocket signaling server running.");
    return;
  }
  let filePath = path.join(FRONTEND_DIST, req.url === "/" ? "index.html" : req.url);
  if (!fs.existsSync(filePath)) filePath = path.join(FRONTEND_DIST, "index.html");
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

const userIdToWebSocket = new Map();
const webSocketToUserId = new Map();
const rooms = new Map();
const memberIdToRooms = new Map();
const userIdToUsername = new Map();
const roomCloseTimers = new Map();

const addUser = (socket) => {
  const userId = uuid();
  userIdToWebSocket.set(userId, socket);
  webSocketToUserId.set(socket, userId);
  socket.send(JSON.stringify({ type: "userId", userId }));
  console.log(`new user : ${userId}`);
};

const closeRoomNow = (hostId) => {
  const room = rooms.get(hostId);
  if (!room) return;
  room.members.forEach((memberId) => {
    if (memberId !== hostId) {
      userIdToWebSocket.get(memberId)?.send(JSON.stringify({ type: "room-closed" }));
    }
    memberIdToRooms.delete(memberId);
  });
  userIdToWebSocket.delete(hostId);
  rooms.delete(hostId);
  userIdToUsername.delete(hostId);
  console.log(`room ${hostId} closed`);
};

const removeUser = (socket) => {
  const userId = webSocketToUserId.get(socket);
  if (!userId) return;
  webSocketToUserId.delete(socket);

  if (rooms.has(userId)) {
    if (roomCloseTimers.has(userId)) return;
    console.log(`host ${userId} disconnected — starting ${HOST_GRACE_MS / 1000}s grace period`);
    const timer = setTimeout(() => {
      roomCloseTimers.delete(userId);
      closeRoomNow(userId);
    }, HOST_GRACE_MS);
    roomCloseTimers.set(userId, timer);
  } else {
    userIdToWebSocket.delete(userId);
    userIdToUsername.delete(userId);
    console.log(`member ${userId} disconnected`);
    const host = memberIdToRooms.get(userId);
    const room = rooms.get(host);
    if (room) {
      room.members = room.members.filter((id) => id !== userId);
      room.members.forEach((memberId) => {
        userIdToWebSocket.get(memberId)?.send(JSON.stringify({ type: "disconnected", memberId: userId }));
      });
    }
    memberIdToRooms.delete(userId);
  }
};

const createRoom = (hostSocket, roomName, genre, isPublic, username) => {
  const hostId = webSocketToUserId.get(hostSocket);
  rooms.set(hostId, { roomName, genre, isPublic, members: [hostId] });
  memberIdToRooms.set(hostId, hostId);
  userIdToUsername.set(hostId, username);
  return hostId;
};

const reconnectHost = (ws, oldHostId) => {
  if (!roomCloseTimers.has(oldHostId)) {
    ws.send(JSON.stringify({ error: "room not found or expired" }));
    return false;
  }
  clearTimeout(roomCloseTimers.get(oldHostId));
  roomCloseTimers.delete(oldHostId);

  const newUserId = webSocketToUserId.get(ws);
  userIdToWebSocket.delete(newUserId);
  userIdToWebSocket.set(oldHostId, ws);
  webSocketToUserId.set(ws, oldHostId);
  memberIdToRooms.set(oldHostId, oldHostId);

  ws.send(JSON.stringify({ type: "host-id", hostId: oldHostId }));
  console.log(`host ${oldHostId} reconnected`);
  return true;
};

const joinRoom = (memberSocket, message) => {
  const { targetId, offer, username } = message;
  const memberId = webSocketToUserId.get(memberSocket);
  if (!memberId) return memberSocket.send(JSON.stringify({ error: "invalid user" }));
  if (!targetId) return memberSocket.send(JSON.stringify({ error: "message should include targetId" }));
  if (!rooms.has(targetId)) return memberSocket.send(JSON.stringify({ error: "invalid targetId" }));
  if (!offer) return memberSocket.send(JSON.stringify({ error: "must send offer" }));

  userIdToUsername.set(memberId, username || memberId);

  const roomMembers = rooms.get(targetId).members.map((id) => ({
    memberId: id,
    username: userIdToUsername.get(id),
  }));
  memberSocket.send(JSON.stringify({ type: "room-members", members: roomMembers }));

  rooms.get(targetId).members.forEach((existingId) => {
    userIdToWebSocket.get(existingId)?.send(JSON.stringify({
      type: "new-member",
      memberId,
      offer,
      username: userIdToUsername.get(memberId),
    }));
  });

  rooms.get(targetId).members.push(memberId);
  memberIdToRooms.set(memberId, targetId);
  console.log(`member ${memberId} joined room ${targetId}`);
};

const sendAnswer = (senderSocket, message) => {
  if (!message.answer || !message.targetId) return;
  const senderId = webSocketToUserId.get(senderSocket);
  userIdToWebSocket.get(message.targetId)?.send(
    JSON.stringify({ type: "create-answer", answer: message.answer, senderId })
  );
};

const handlePeerConnectionOffer = (senderSocket, message) => {
  const senderId = webSocketToUserId.get(senderSocket);
  const { targetId, offer } = message;
  if (!targetId || !offer) return;
  userIdToWebSocket.get(targetId)?.send(
    JSON.stringify({ type: "peer-connection-offer", senderId, offer })
  );
};

const handlePeerConnectionAnswer = (senderSocket, message) => {
  const senderId = webSocketToUserId.get(senderSocket);
  const { targetId, answer } = message;
  if (!targetId || !answer) return;
  userIdToWebSocket.get(targetId)?.send(
    JSON.stringify({ type: "peer-connection-answer", senderId, answer })
  );
};

const exchangeCandidate = (socket, message) => {
  if (!message.targetId || !message.candidate) return;
  const senderId = webSocketToUserId.get(socket);
  userIdToWebSocket.get(message.targetId)?.send(
    JSON.stringify({ type: "ice-candidate", candidate: message.candidate, senderId })
  );
};

const sendChatMessage = (ws, text) => {
  const senderId = webSocketToUserId.get(ws);
  const roomId = memberIdToRooms.get(senderId) || senderId;
  const room = rooms.get(roomId);
  if (!room) return;
  room.members.forEach((receiverId) => {
    userIdToWebSocket.get(receiverId)?.send(
      JSON.stringify({ type: "chat-message", senderId, text, timestamp: Date.now() })
    );
  });
};

wss.on("connection", (ws) => {
  addUser(ws);

  ws.on("close", () => removeUser(ws));
  ws.on("error", (err) => { console.error("websocket error:", err); removeUser(ws); });

  ws.on("message", (data) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }

    switch (message.type) {
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;
      case "create-room": {
        const hostId = createRoom(ws, message.roomName, message.genre, message.isPublic, message.username);
        ws.send(JSON.stringify({ type: "host-id", hostId }));
        console.log(`user created room ${hostId}`);
        break;
      }
      case "reconnect-host":
        reconnectHost(ws, message.roomId);
        break;
      case "join-room":
        joinRoom(ws, message);
        break;
      case "create-answer":
        sendAnswer(ws, message);
        break;
      case "peer-connection-offer":
        handlePeerConnectionOffer(ws, message);
        break;
      case "peer-connection-answer":
        handlePeerConnectionAnswer(ws, message);
        break;
      case "ice-candidate":
        exchangeCandidate(ws, message);
        break;
      case "public-rooms":
        ws.send(JSON.stringify({ type: "public-rooms", rooms: Object.fromEntries(rooms) }));
        break;
      case "chat-message":
        sendChatMessage(ws, message.text);
        break;
      default:
        ws.send(JSON.stringify({ error: "invalid message type" }));
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`server listening on port ${PORT}`);
});
