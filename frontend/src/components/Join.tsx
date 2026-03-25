import { FormEvent, useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Toggleable from "./Toggleable";
import { getWsUrl } from "../utils/wsUrl";
import { sendFileOverChannel, formatBytes, FileMeta, TransferControl, getFilesFromDataTransfer } from "../utils/fileTransfer";

interface ChatMessage { senderId: string; text: string; timestamp: number; }
interface Transfer {
  id: string; peerId: string; name: string; size: number;
  progress: number; direction: "send" | "receive"; status: "active" | "done" | "error"; paused: boolean;
  speed?: number;
}
interface PeerState { pc: RTCPeerConnection; dataChannel: RTCDataChannel | null; }

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

const HEARTBEAT_MS = 15_000;
const JOIN_KEY = "filedrop-join-session";

const Join = () => {
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<Map<string, PeerState>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidate[]>>(new Map());
  const userIdToUsernameRef = useRef<Map<string, string>>(new Map());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const sendControlsRef = useRef<Map<string, TransferControl>>(new Map());
  const recvCancelRef = useRef<Map<string, () => void>>(new Map());
  const lastBytesRef = useRef<Map<string, { bytes: number; time: number }>>(new Map());

  const [roomMembers, setRoomMembers] = useState<string[]>([]);
  const [isInRoom, setIsInRoom] = useState(false);
  const [hostId, setHostId] = useState("");
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");
  const [enterID, setEnterID] = useState(true);
  const [publicRoom, setPublicRoom] = useState(false);
  const [disRoom, setDisRoom] = useState<any[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [copied, setCopied] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [logs, setLogs] = useState<{ time: string; text: string; type: "info" | "success" | "error" | "warn" }[]>([]);
  const [globalDrag, setGlobalDrag] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const addLog = useCallback((text: string, type: "info" | "success" | "error" | "warn" = "info") => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(prev => [...prev.slice(-50), { time, text, type }]);
  }, []);

  const calcSpeed = useCallback((tid: string, sentBytes: number) => {
    const now = Date.now();
    const last = lastBytesRef.current.get(tid);
    if (last && now - last.time > 500) {
      const speed = ((sentBytes - last.bytes) / ((now - last.time) / 1000));
      lastBytesRef.current.set(tid, { bytes: sentBytes, time: now });
      return speed;
    }
    if (!last) lastBytesRef.current.set(tid, { bytes: sentBytes, time: now });
    return undefined;
  }, []);

  const upsertTransfer = useCallback((t: Transfer) => {
    setTransfers((prev) => {
      const idx = prev.findIndex((x) => x.id === t.id);
      if (idx === -1) return [...prev, t];
      const next = [...prev]; next[idx] = t; return next;
    });
  }, []);

  const makeReceiveHandler = useCallback((peerId: string) => {
    let meta: FileMeta | null = null;
    let buffers: ArrayBuffer[] = [];
    let receivedBytes = 0;
    let tid = "";
    let cancelled = false;
    let fileStream: any = null;
    let fileHandle: any = null;
    let isWriting = false;

    const processQueue = async () => {
      if (isWriting || !fileStream || buffers.length === 0) return;
      isWriting = true;
      while (buffers.length > 0 && !cancelled) {
        const chunk = buffers.shift();
        if (chunk && fileStream) await fileStream.write(chunk).catch(()=>{});
      }
      isWriting = false;
    };

    const cancelFn = () => {
      cancelled = true;
      if (tid) upsertTransfer({ id: tid, peerId, name: meta?.name ?? "", size: meta?.size ?? 0, progress: 0, direction: "receive", status: "error", paused: false });
      if (fileStream) { fileStream.close().catch(()=>{}); }
      meta = null; buffers = [];
    };

    return async (ev: MessageEvent) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data);
        if (msg.type === "file-meta") {
          meta = msg as FileMeta; buffers = []; receivedBytes = 0; cancelled = false;
          fileStream = null; fileHandle = null;
          tid = `recv-${peerId}-${Date.now()}`;
          recvCancelRef.current.set(tid, cancelFn);
          upsertTransfer({ id: tid, peerId, name: meta.name, size: meta.size, progress: 0, direction: "receive", status: "active", paused: false });
          addLog(`RECV ← ${meta.name} (${formatBytes(meta.size)})`, "info");

          try {
            const root = await navigator.storage.getDirectory();
            fileHandle = await root.getFileHandle(tid, { create: true });
            fileStream = await fileHandle.createWritable();
          } catch (e) {
            // RAM fallback
          }
        } else if (msg.type === "EOF") {
          if (!cancelled && meta) {
            const currentMeta = meta;
            const currentBuffers = buffers;
            const currentTid = tid;
            const currentStream = fileStream;
            const currentHandle = fileHandle;

            const finish = async () => {
              while (isWriting || (currentStream && buffers.length > 0)) {
                await new Promise(r => setTimeout(r, 20));
              }
              let url: string;
              if (currentStream) {
                await currentStream.close().catch(()=>{});
                const file = await currentHandle.getFile();
                url = URL.createObjectURL(file);
              } else {
                url = URL.createObjectURL(new Blob(currentBuffers));
              }
              const a = document.createElement("a"); a.href = url; a.download = currentMeta.name;
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(url), 10000);

              if (currentStream) {
                const root = await navigator.storage.getDirectory();
                root.removeEntry(currentTid).catch(()=>{});
              }
              upsertTransfer({ id: currentTid, peerId, name: currentMeta.name, size: currentMeta.size, progress: 100, direction: "receive", status: "done", paused: false });
              addLog(`RECV ✓ ${currentMeta.name} complete`, "success");
            };
            finish().catch(console.error);
          }
          recvCancelRef.current.delete(tid);
        } else if (msg.type === "transfer-cancelled") {
          cancelled = true;
          if (tid) upsertTransfer({ id: tid, peerId, name: meta?.name ?? "", size: meta?.size ?? 0, progress: 0, direction: "receive", status: "error", paused: false });
          addLog(`RECV ✕ transfer cancelled`, "error");
          if (fileStream) { fileStream.close().catch(()=>{}); }
          meta = null; buffers = [];
        }
      } else if (ev.data instanceof ArrayBuffer && !cancelled) {
        buffers.push(ev.data);
        if (fileStream) {
          processQueue();
        }
        receivedBytes += ev.data.byteLength;
        
        let lastProgressTime = 0;
        if (meta) {
          const now = Date.now();
          if (now - lastProgressTime > 50 || receivedBytes === meta.size) {
            const speed = calcSpeed(tid, receivedBytes);
            upsertTransfer({ id: tid, peerId, name: meta.name, size: meta.size, progress: Math.round((receivedBytes / meta.size) * 100), direction: "receive", status: "active", paused: false, speed });
            lastProgressTime = now;
          }
        }
      }
    };
  }, [upsertTransfer, addLog, calcSpeed]);

  const setupDataChannel = useCallback((dc: RTCDataChannel, peerId: string) => {
    dc.binaryType = "arraybuffer";
    dc.onmessage = makeReceiveHandler(peerId);
    dc.onerror = (e) => console.error(`DC error with ${peerId}`, e);
  }, [makeReceiveHandler]);

  const initiatePeerConnection = useCallback(async (targetId: string) => {
    if (peerConnectionRef.current.has(targetId)) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const dc = pc.createDataChannel("fileTransfer", { ordered: true });
    setupDataChannel(dc, targetId);
    peerConnectionRef.current.set(targetId, { pc, dataChannel: dc });
    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current?.send(JSON.stringify({ type: "ice-candidate", candidate: e.candidate, targetId }));
    };
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current?.send(JSON.stringify({ type: "peer-connection-offer", targetId, offer }));
    } catch (err) { console.error(`offer error for ${targetId}`, err); }
  }, [setupDataChannel]);

  const handlePeerOffer = useCallback(async (senderId: string, offer: RTCSessionDescriptionInit) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnectionRef.current.set(senderId, { pc, dataChannel: null });
    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      setupDataChannel(dc, senderId);
      peerConnectionRef.current.set(senderId, { pc, dataChannel: dc });
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current?.send(JSON.stringify({ type: "ice-candidate", candidate: e.candidate, targetId: senderId }));
    };
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.send(JSON.stringify({ type: "peer-connection-answer", targetId: senderId, answer }));
    } catch (err) { console.error(`peer offer error from ${senderId}`, err); }
    const pending = pendingIceRef.current.get(senderId) || [];
    for (const c of pending) { try { await pc.addIceCandidate(c); } catch {} }
    pendingIceRef.current.delete(senderId);
  }, [setupDataChannel]);

  const handlePeerAnswer = useCallback(async (senderId: string, answer: RTCSessionDescriptionInit) => {
    const conn = peerConnectionRef.current.get(senderId);
    if (!conn?.pc) return;
    try {
      await conn.pc.setRemoteDescription(answer);
      const pending = pendingIceRef.current.get(senderId) || [];
      for (const c of pending) { try { await conn.pc.addIceCandidate(c); } catch {} }
      pendingIceRef.current.delete(senderId);
    } catch (err) { console.error(`answer error from ${senderId}`, err); }
  }, []);

  const startHeartbeat = useCallback((socket: WebSocket) => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, HEARTBEAT_MS);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
  }, []);

  const initSocket = useCallback(() => {
    const socket = new WebSocket(getWsUrl());
    socketRef.current = socket;

    socket.onopen = () => { setReconnecting(false); startHeartbeat(socket); addLog("WebSocket connected", "success"); };
    socket.onerror = () => addLog("WebSocket error", "error");

    socket.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "pong") return;
      if (msg.type === "userId") { setUserId(msg.userId); }
      else if (msg.type === "new-member") {
        const { memberId, username: mu } = msg;
        if (mu) userIdToUsernameRef.current.set(memberId, mu);
        setRoomMembers((p) => p.includes(memberId) ? p : [...p, memberId]);
        addLog(`Peer joined: ${mu || memberId.slice(0, 8)}`, "success");
      } else if (msg.type === "create-answer") {
        const pc = peerConnectionRef.current.get(msg.senderId)?.pc;
        if (pc) { try { await pc.setRemoteDescription(msg.answer); setIsInRoom(true); addLog("Joined room successfully", "success"); } catch {} }
      } else if (msg.type === "room-members") {
        const { members }: { members: { memberId: string; username: string }[] } = msg;
        const ids = members.map((m) => { userIdToUsernameRef.current.set(m.memberId, m.username); return m.memberId; });
        setRoomMembers(ids);
        ids.forEach((id) => initiatePeerConnection(id));
      } else if (msg.type === "peer-connection-offer") {
        await handlePeerOffer(msg.senderId, msg.offer);
      } else if (msg.type === "peer-connection-answer") {
        await handlePeerAnswer(msg.senderId, msg.answer);
      } else if (msg.type === "ice-candidate") {
        const { senderId, candidate } = msg;
        const conn = peerConnectionRef.current.get(senderId);
        if (!conn?.pc?.remoteDescription) {
          if (!pendingIceRef.current.has(senderId)) pendingIceRef.current.set(senderId, []);
          pendingIceRef.current.get(senderId)!.push(new RTCIceCandidate(candidate));
        } else { try { await conn.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {} }
      } else if (msg.type === "public-rooms") {
        setDisRoom(Object.entries(msg.rooms).map(([id, r]: [string, any]) => ({ id, name: r.roomName, genre: r.genre, isPublic: r.isPublic, users: r.members.length })));
      } else if (msg.type === "room-closed") {
        try { sessionStorage.removeItem(JOIN_KEY); } catch {}
        peerConnectionRef.current.forEach((v) => v.pc.close());
        socketRef.current?.close();
        addLog("Room closed by host", "warn");
        navigate("/");
      } else if (msg.type === "disconnected") {
        const name = userIdToUsernameRef.current.get(msg.memberId) || msg.memberId.slice(0, 8);
        addLog(`Peer left: ${name}`, "warn");
        setRoomMembers((p) => p.filter((id) => id !== msg.memberId));
        peerConnectionRef.current.get(msg.memberId)?.pc?.close();
        peerConnectionRef.current.delete(msg.memberId);
      } else if (msg.type === "chat-message") {
        setChatMessages((p) => [...p, { senderId: msg.senderId, text: msg.text, timestamp: msg.timestamp }]);
      }
    };

    socket.onclose = () => {
      stopHeartbeat();
      if (intentionalCloseRef.current) return;
      if (!isInRoom) return;
      setReconnecting(true);
      addLog("Connection lost, reconnecting...", "warn");
      reconnectTimerRef.current = setTimeout(() => initSocket(), 2000);
    };

    return socket;
  }, [initiatePeerConnection, handlePeerOffer, handlePeerAnswer, startHeartbeat, stopHeartbeat, navigate, isInRoom, addLog]);

  useEffect(() => {
    initSocket();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const ws = socketRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          setReconnecting(true); initSocket();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const handleWindowDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.types.includes("Files")) setGlobalDrag(true);
    };
    window.addEventListener("dragenter", handleWindowDragEnter);
    
    return () => {
      intentionalCloseRef.current = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("dragenter", handleWindowDragEnter);
      stopHeartbeat();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      peerConnectionRef.current.forEach((v) => v.pc.close());
      peerConnectionRef.current = new Map(); // Reset the map
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) {
      setHostId(id);
      setEnterID(true);
      setPublicRoom(false);
    }
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const handleJoinRoom = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return alert("Please enter a display name");
    const socket = socketRef.current;
    if (!socket) return;
    try { sessionStorage.setItem(JOIN_KEY, JSON.stringify({ hostId, username })); } catch {}
    addLog(`Connecting to room ${hostId.slice(0, 8)}...`, "info");
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const dc = pc.createDataChannel("fileTransfer", { ordered: true });
    setupDataChannel(dc, hostId);
    peerConnectionRef.current.set(hostId, { pc, dataChannel: dc });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) socket.send(JSON.stringify({ type: "ice-candidate", candidate: ev.candidate, targetId: hostId }));
    };
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.send(JSON.stringify({ type: "join-room", targetId: hostId, offer, username }));
    } catch (err) { console.error("join offer error", err); }
  };

  const sendFiles = async (peerId: string, files: File[]) => {
    const conn = peerConnectionRef.current.get(peerId);
    if (!conn?.dataChannel) { alert("Not connected to this peer yet"); return; }
    const dc = conn.dataChannel;
    const ensureOpen = () => dc.readyState === "open"
      ? Promise.resolve()
      : new Promise<void>((r) => { dc.onopen = () => r(); });

    for (const file of files) {
      const tid = `send-${peerId}-${file.name}-${Date.now()}`;
      upsertTransfer({ id: tid, peerId, name: file.name, size: file.size, progress: 0, direction: "send", status: "active", paused: false });
      addLog(`SEND → ${file.name} (${formatBytes(file.size)})`, "info");
      const filePath = (file as any).webkitRelativePath || file.name;
      try {
        await ensureOpen();
        const { promise, control } = sendFileOverChannel(file, dc, filePath, (sent, total) => {
          const speed = calcSpeed(tid, sent);
          upsertTransfer({ id: tid, peerId, name: file.name, size: total, progress: Math.round((sent / total) * 100), direction: "send", status: "active", paused: false, speed });
        });
        sendControlsRef.current.set(tid, control);
        await promise;
        sendControlsRef.current.delete(tid);
        upsertTransfer({ id: tid, peerId, name: file.name, size: file.size, progress: 100, direction: "send", status: "done", paused: false });
        addLog(`SEND ✓ ${file.name} complete`, "success");
      } catch {
        sendControlsRef.current.delete(tid);
        upsertTransfer({ id: tid, peerId, name: file.name, size: file.size, progress: 0, direction: "send", status: "error", paused: false });
        addLog(`SEND ✕ ${file.name} failed`, "error");
      }
    }
  };

  const pauseTransfer = (tid: string) => {
    sendControlsRef.current.get(tid)?.pause();
    setTransfers((p) => p.map((t) => t.id === tid ? { ...t, paused: true } : t));
  };
  const resumeTransfer = (tid: string) => {
    sendControlsRef.current.get(tid)?.resume();
    setTransfers((p) => p.map((t) => t.id === tid ? { ...t, paused: false } : t));
  };
  const cancelTransfer = (t: Transfer) => {
    if (t.direction === "send") {
      sendControlsRef.current.get(t.id)?.cancel();
      sendControlsRef.current.delete(t.id);
    } else {
      recvCancelRef.current.get(t.id)?.();
      recvCancelRef.current.delete(t.id);
    }
    setTransfers((p) => p.map((x) => x.id === t.id ? { ...x, status: "error" } : x));
    addLog(`Transfer cancelled: ${t.name}`, "error");
  };

  const openPicker = (peerId: string, folder = false) => {
    const input = document.createElement("input");
    input.type = "file"; 
    input.setAttribute("multiple", "multiple");
    if (folder) {
      input.setAttribute("webkitdirectory", "true");
      input.setAttribute("directory", "true");
    }
    input.onchange = () => { if (input.files) sendFiles(peerId, Array.from(input.files)); };
    input.click();
  };


  const handleGlobalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setGlobalDrag(false);
    
    // In Join, allPeers isn't accessible dynamically inside this closure easily 
    // unless we get it from state. But we can access roomMembers and hostId state directly.
    const targets = [...new Set([...roomMembers, hostId].filter(Boolean))];
    if (targets.length === 0) return;

    const items = e.dataTransfer.items;
    let files: File[] = [];
    if (items && items.length > 0) files = await getFilesFromDataTransfer(items);
    else files = Array.from(e.dataTransfer.files);
    
    if (files.length > 0) {
      targets.forEach((peerId) => sendFiles(peerId, files));
    }
  };

  const leaveRoom = () => {
    intentionalCloseRef.current = true;
    try { sessionStorage.removeItem(JOIN_KEY); } catch {}
    navigate("/");
  };

  const sendMessage = () => {
    if (newMessage.trim() && socketRef.current) {
      socketRef.current.send(JSON.stringify({ type: "chat-message", text: newMessage.trim() }));
      setNewMessage("");
    }
  };

  const allPeers = [...new Set([...roomMembers, hostId].filter(Boolean))];
  const activeTransfers = transfers.filter((t) => t.status === "active");
  const doneTransfers = transfers.filter((t) => t.status !== "active");

  return (
    <div className="w-full min-h-screen bg-cyber-black grid-bg">
      <AnimatePresence>
        {globalDrag && isInRoom && (
          <motion.div 
            onDragLeave={() => setGlobalDrag(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleGlobalDrop}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-cyber-black/90 backdrop-blur-sm border-4 border-dashed border-neon-green flex flex-col items-center justify-center pointer-events-auto"
          >
            <div className="w-32 h-32 mb-6 border-2 border-neon-green flex items-center justify-center rounded-full animate-pulse-slow box-glow pointer-events-none">
              <span className="text-neon-green text-5xl">↓</span>
            </div>
            <h2 className="text-4xl font-display text-neon-green text-glow mb-2 pointer-events-none">RELEASE TO BEAM</h2>
            <p className="text-neon-green/60 font-mono tracking-widest uppercase pointer-events-none">Sending to {allPeers.length} connected peer{allPeers.length !== 1 ? "s" : ""}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reconnecting && (
          <motion.div
            initial={{ y: -40 }} animate={{ y: 0 }} exit={{ y: -40 }}
            className="fixed top-0 left-0 right-0 z-50 bg-neon-amber/10 border-b border-neon-amber/30 text-neon-amber text-center text-xs py-2 font-mono uppercase tracking-wider"
          >
            ▸ RECONNECTING…
          </motion.div>
        )}
      </AnimatePresence>

      {!isInRoom && (
        <div className="min-h-screen flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md"
          >
            <div className="text-center mb-8">
              <p className="text-xs font-mono text-neon-green/50 uppercase tracking-[0.3em] mb-1">// CONNECT</p>
              <h1 className="text-2xl font-display text-neon-green text-glow">JOIN ROOM</h1>
              <p className="text-cyber-gray text-xs font-mono mt-2">Enter a room ID or browse public rooms</p>
            </div>
            <div className="card overflow-hidden">
              <div className="flex border-b border-cyber-darkgray">
                <button onClick={() => { setEnterID(true); setPublicRoom(false); }} className={`flex-1 py-3 text-xs font-mono font-bold uppercase tracking-wider transition-all ${enterID ? "bg-neon-green/10 text-neon-green border-b-2 border-neon-green" : "text-cyber-gray hover:text-neon-green"}`}>ROOM ID</button>
                <button onClick={() => { setPublicRoom(true); setEnterID(false); socketRef.current?.send(JSON.stringify({ type: "public-rooms" })); }} className={`flex-1 py-3 text-xs font-mono font-bold uppercase tracking-wider transition-all ${publicRoom ? "bg-neon-green/10 text-neon-green border-b-2 border-neon-green" : "text-cyber-gray hover:text-neon-green"}`}>PUBLIC ROOMS</button>
              </div>
              {enterID && (
                <form onSubmit={handleJoinRoom} className="p-6 space-y-4">
                  <div><label className="label">HOST_ROOM_ID</label><input type="text" placeholder="paste-room-id-here" value={hostId} onChange={(e) => setHostId(e.target.value)} required className="input-field" /></div>
                  <div><label className="label">DISPLAY_NAME</label><input type="text" placeholder="your-handle" value={username} onChange={(e) => setUsername(e.target.value)} required className="input-field" /></div>
                  <button type="submit" className="btn-primary w-full py-3">▸ CONNECT</button>
                </form>
              )}
              {publicRoom && (
                <div className="p-4">
                  {disRoom.filter((r) => r.isPublic).length === 0 ? (
                    <div className="text-center py-10 text-cyber-darkgray">
                      <p className="text-xs font-mono">NO PUBLIC ROOMS AVAILABLE</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-cyber-darkgray/30">
                      {disRoom.filter((r) => r.isPublic).map((room) => (
                        <li key={room.id} className="flex items-center justify-between py-3 px-1">
                          <div>
                            <p className="font-mono font-bold text-neon-green text-sm">{room.name}</p>
                            <p className="text-[10px] text-cyber-darkgray font-mono mt-0.5">{room.genre} • {room.users} peer{room.users !== 1 ? "s" : ""}</p>
                          </div>
                          <button onClick={() => { setHostId(room.id); setEnterID(true); setPublicRoom(false); }} className="btn-secondary text-[10px] px-3 py-1.5">SELECT</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {isInRoom && (
        <>
          <div className="bg-cyber-surface border-b border-neon-green/20 py-4 px-4 sm:px-6" style={{ marginTop: reconnecting ? "2rem" : 0 }}>
            <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-neon-green/40 text-[10px] font-mono uppercase tracking-[0.3em] mb-0.5">// MEMBER MODE</p>
                <h1 className="text-lg font-display text-neon-green text-glow">
                  CONNECTED AS <span className="text-neon-cyan">{username.toUpperCase()}</span>
                </h1>
                <p className="text-[10px] font-mono text-neon-green/60 mt-1 flex items-center gap-1">
                  <span className="w-1 h-1 bg-neon-green rounded-full pulse-dot"></span>
                  END-TO-END ENCRYPTED (DTLS)
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 border border-neon-green/20 bg-cyber-black px-3 py-2">
                  <span className="text-neon-green/40 text-[10px] font-mono">LINK:</span>
                  <span className="font-mono text-xs text-neon-green truncate max-w-[160px]">{hostId}</span>
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/join?id=${hostId}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }} className="p-1 border border-neon-green/20 hover:border-neon-green text-neon-green text-[10px] transition-all">
                    {copied ? "✓" : "⧉"}
                  </button>
                </div>
                <button onClick={leaveRoom} className="btn-danger text-xs">✕ LEAVE</button>
              </div>
            </div>
          </div>

          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 flex flex-col gap-4">
              {/* Peers */}
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="section-title flex items-center gap-2">
                    <span className="text-neon-green">⬡</span> ROOM PEERS
                  </h2>
                  <span className="badge border-neon-green/30 text-neon-green">{allPeers.length}</span>
                </div>
                {allPeers.length === 0 ? (
                  <div className="border border-dashed border-cyber-darkgray p-10 text-center"><p className="text-cyber-gray text-xs font-mono">NO OTHER PEERS YET</p></div>
                ) : (
                  <ul className="space-y-3">
                    {allPeers.map((peerId) => (
                      <li key={peerId}
                        className={`border p-4 transition-all duration-150 border-cyber-darkgray/40 hover:border-cyber-darkgray`}
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 bg-neon-green rounded-full pulse-dot" />
                            <div className="flex items-center gap-2">
                              <Toggleable username={peerId === hostId ? (userIdToUsernameRef.current.get(peerId) || "Host") : (userIdToUsernameRef.current.get(peerId) || "Unknown")} userId={peerId} />
                              {peerId === hostId && <span className="badge border-neon-amber/30 text-neon-amber text-[10px]">HOST</span>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => openPicker(peerId, false)} className="btn-primary text-[10px] px-3 py-1.5">FILE</button>
                            <button onClick={() => openPicker(peerId, true)} className="btn-secondary text-[10px] px-3 py-1.5">FOLDER</button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Active Transfers */}
              <AnimatePresence>
                {activeTransfers.length > 0 && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card p-5">
                    <h2 className="section-title flex items-center gap-2 mb-4">
                      <span className="w-2 h-2 bg-neon-green rounded-full animate-pulse" />
                      ACTIVE TRANSFERS
                    </h2>
                    <ul className="space-y-3">
                      {activeTransfers.map((t) => (
                        <li key={t.id} className="bg-cyber-black border border-cyber-darkgray/40 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`badge flex-shrink-0 ${t.direction === "send" ? "border-neon-cyan text-neon-cyan" : "border-neon-green text-neon-green"}`}>
                                {t.direction === "send" ? "↑ OUT" : "↓ IN"}
                              </span>
                              <span className="text-xs font-mono text-cyber-light truncate">{t.name}</span>
                              {t.paused && <span className="badge border-neon-amber text-neon-amber">PAUSED</span>}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              {t.speed != null && (
                                <span className="text-[10px] font-mono text-neon-green">{formatBytes(t.speed)}/s</span>
                              )}
                              <span className="text-[10px] font-mono text-cyber-darkgray">{formatBytes(t.size)}</span>
                              {t.direction === "send" && (
                                t.paused
                                  ? <button onClick={() => resumeTransfer(t.id)} className="p-1 border border-neon-green/30 hover:border-neon-green text-neon-green transition-all text-xs">▶</button>
                                  : <button onClick={() => pauseTransfer(t.id)} className="p-1 border border-neon-amber/30 hover:border-neon-amber text-neon-amber transition-all text-xs">⏸</button>
                              )}
                              <button onClick={() => cancelTransfer(t)} className="p-1 border border-neon-red/30 hover:border-neon-red text-neon-red transition-all text-xs">✕</button>
                            </div>
                          </div>
                          <div className="progress-bar-track">
                            <div className={`progress-bar-fill ${t.paused ? "bg-neon-amber" : "bg-neon-green"}`} style={{ width: `${t.progress}%` }} />
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-[10px] font-mono text-cyber-darkgray">{formatBytes(Math.round(t.size * t.progress / 100))} / {formatBytes(t.size)}</span>
                            <span className="text-[10px] font-mono text-neon-green">{t.progress}%</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Completed */}
              {doneTransfers.length > 0 && (
                <div className="card p-5">
                  <h2 className="section-title flex items-center gap-2 mb-4">✓ TRANSFER LOG</h2>
                  <ul className="divide-y divide-cyber-darkgray/30">
                    {doneTransfers.slice(-10).map((t) => (
                      <li key={t.id} className="flex items-center justify-between py-2.5 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`badge flex-shrink-0 ${t.status === "error" ? "border-neon-red text-neon-red" : t.direction === "send" ? "border-neon-cyan text-neon-cyan" : "border-neon-green text-neon-green"}`}>
                            {t.status === "error" ? "✕ ERR" : t.direction === "send" ? "↑ SENT" : "↓ RECV"}
                          </span>
                          <span className="text-xs font-mono text-cyber-gray truncate">{t.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-cyber-darkgray flex-shrink-0">{formatBytes(t.size)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Terminal Log */}
              <div className="card p-5">
                <h2 className="section-title flex items-center gap-2 mb-4">&gt;_ ACTIVITY LOG</h2>
                <div className="bg-cyber-black border border-cyber-darkgray/30 p-3 max-h-48 overflow-y-auto font-mono text-xs">
                  {logs.length === 0 ? (
                    <p className="text-cyber-darkgray">Waiting for activity...</p>
                  ) : logs.map((log, i) => (
                    <div key={i} className="flex gap-2 leading-relaxed">
                      <span className="text-cyber-darkgray flex-shrink-0">[{log.time}]</span>
                      <span className={
                        log.type === "success" ? "text-neon-green" :
                        log.type === "error" ? "text-neon-red" :
                        log.type === "warn" ? "text-neon-amber" :
                        "text-neon-cyan"
                      }>{log.text}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>

            {/* Chat */}
            <div className="card p-5 flex flex-col" style={{ minHeight: "420px" }}>
              <h2 className="section-title flex items-center gap-2 mb-4">⬡ ROOM CHAT</h2>
              <div className="flex-1 overflow-y-auto space-y-2.5 mb-4 -mr-1 pr-1">
                {chatMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-cyber-darkgray text-xs font-mono">NO MESSAGES</div>
                ) : chatMessages.map((msg, i) => {
                  const isMe = msg.senderId === userId;
                  return (
                    <div key={i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[85%] px-3 py-2 ${isMe ? "bg-neon-green/10 border border-neon-green/20 text-neon-green" : "bg-cyber-surface border border-cyber-darkgray text-cyber-light"}`}>
                        <p className={`text-[10px] font-mono font-bold mb-0.5 ${isMe ? "text-neon-green/50" : "text-cyber-darkgray"}`}>{isMe ? "YOU" : (userIdToUsernameRef.current.get(msg.senderId) || "UNKNOWN")}</p>
                        <p className="text-xs font-mono leading-relaxed">{msg.text}</p>
                      </div>
                      <p className="text-[10px] text-cyber-darkgray mt-0.5 px-1 font-mono">{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2 pt-3 border-t border-cyber-darkgray/30">
                <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="> type message..." className="input-field flex-1 py-2 text-xs" />
                <button onClick={sendMessage} className="btn-primary px-3 py-2 text-xs">▸</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Join;
