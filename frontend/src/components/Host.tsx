import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Toggleable from "./Toggleable";
import { getWsUrl } from "../utils/wsUrl";
import { sendFileOverChannels, formatBytes, FileMeta, TransferControl, getFilesFromDataTransfer } from "../utils/fileTransfer";

interface ChatMessage { senderId: string; text: string; timestamp: number; }
interface Transfer {
  id: string; peerId: string; name: string; size: number;
  progress: number; direction: "send" | "receive"; status: "active" | "done" | "error"; paused: boolean;
  speed?: number; startTime?: number;
}
interface PeerState { pc: RTCPeerConnection; dataChannels: RTCDataChannel[]; }

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

const STORAGE_KEY = "filedrop-host-session";
const HEARTBEAT_MS = 15_000;

const Host = () => {
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, PeerState>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidate[]>>(new Map());
  const userIdToUsernameRef = useRef<Map<string, string>>(new Map());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const sendControlsRef = useRef<Map<string, TransferControl>>(new Map());
  const recvCancelRef = useRef<Map<string, () => void>>(new Map());
  const transferStartRef = useRef<Map<string, number>>(new Map());
  const lastBytesRef = useRef<Map<string, { bytes: number; time: number }>>(new Map());
  const receiverStateRef = useRef<Map<string, any>>(new Map());

  const [hostId, setHostId] = useState("");
  const [roomInfo, setRoomInfo] = useState<{ roomName: string; isPublic: boolean; genre: string; username: string } | null>(null);
  const [members, setMembers] = useState<string[]>([]);
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
  const location = useLocation();

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
    const triggerFinish = async (state: any) => {
      if (state.cancelled || !state.meta || state.status === "done") return;
      state.status = "done";
      let url: string;
      if (state.fileStream) {
        try { await state.fileStream.close(); } catch(e) { console.error("close stream err", e); }
        try {
          const file = await state.fileHandle.getFile();
          url = URL.createObjectURL(file);
        } catch(e) { console.error("getFile err", e); return; }
      } else {
        const rawBuffers = state.buffers.map((b: any) => b.chunk);
        url = URL.createObjectURL(new Blob(rawBuffers));
      }
      const a = document.createElement("a"); a.href = url; a.download = state.meta.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      const isOpfs = !!state.fileStream;
      const tempTid = state.tid;
      setTimeout(async () => {
        URL.revokeObjectURL(url);
        if (isOpfs && tempTid) {
          try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry(tempTid);
          } catch(e) {}
        }
      }, 300000);
      upsertTransfer({ id: state.tid, peerId, name: state.meta.name, size: state.meta.size, progress: 100, direction: "receive", status: "done", paused: false });
      addLog(`RECV ✓ ${state.meta.name} complete`, "success");
    };

    const processQueue = async (state: any) => {
      if (state.isWriting || (!state.fileStream && !state.opfsFailed)) return;
      state.isWriting = true;
      while (state.buffers.length > 0 && !state.cancelled) {
        const item = state.buffers.shift();
        if (item && state.fileStream) {
          await state.fileStream.write(item.chunk).catch(console.error);
        }
      }
      state.isWriting = false;
      
      if (state.receivedBytes === state.meta?.size && state.buffers.length === 0 && !state.isFinishing) {
         state.isFinishing = true;
         triggerFinish(state);
      } else if (state.opfsFailed && state.receivedBytes === state.meta?.size && !state.isFinishing) {
         state.isFinishing = true;
         triggerFinish(state);
      }
    };

    const cancelFn = (state: any) => {
      state.cancelled = true;
      if (state.tid) upsertTransfer({ id: state.tid, peerId, name: state.meta?.name ?? "", size: state.meta?.size ?? 0, progress: 0, direction: "receive", status: "error", paused: false });
      if (state.fileStream) { state.fileStream.close().catch(()=>{}); }
      state.meta = null; state.buffers = [];
    };

    const handler = async (ev: MessageEvent) => {
      let state = receiverStateRef.current.get(peerId);
      if (!state) {
        state = { meta: null, buffers: [], receivedBytes: 0, tid: "", cancelled: false, fileStream: null, fileHandle: null, isWriting: false, opfsFailed: false };
        receiverStateRef.current.set(peerId, state);
      }

      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data);
        if (msg.type === "file-meta") {
          state = {
            meta: msg as FileMeta, buffers: [], receivedBytes: 0, tid: `recv-${peerId}-${Date.now()}`,
            cancelled: false, fileStream: null, fileHandle: null, isWriting: false, opfsFailed: false, isFinishing: false, status: "active"
          };
          receiverStateRef.current.set(peerId, state);

          recvCancelRef.current.set(state.tid, () => cancelFn(state));
          transferStartRef.current.set(state.tid, Date.now());
          upsertTransfer({ id: state.tid, peerId, name: state.meta.name, size: state.meta.size, progress: 0, direction: "receive", status: "active", paused: false });
          addLog(`RECV ← ${state.meta.name} (${formatBytes(state.meta.size)})`, "info");
          
          (async () => {
            try {
              const root = await navigator.storage.getDirectory();
              state.fileHandle = await root.getFileHandle(state.tid, { create: true });
              state.fileStream = await state.fileHandle.createWritable();
              processQueue(state);
            } catch (e) {
              state.opfsFailed = true;
              processQueue(state);
            }
          })();
        } else if (msg.type === "EOF") {
           // EOF ignored in favor of byte-level chunk completion checks
        } else if (msg.type === "transfer-cancelled") {
          cancelFn(state); addLog(`RECV ✕ transfer cancelled`, "error");
        }
      } else if (ev.data instanceof ArrayBuffer && !state.cancelled) {
        const chunk = ev.data;

        state.buffers.push({ chunk });
        state.receivedBytes += chunk.byteLength;
        
        processQueue(state);
        
        let lastProgressTime = 0;
        if (state.meta) {
          const now = Date.now();
          if (now - lastProgressTime > 50 || state.receivedBytes === state.meta.size) {
            const speed = calcSpeed(state.tid, state.receivedBytes);
            upsertTransfer({ id: state.tid, peerId, name: state.meta.name, size: state.meta.size, progress: Math.min(100, Math.round((state.receivedBytes / state.meta.size) * 100)), direction: "receive", status: "active", paused: false, speed });
            lastProgressTime = now;
          }
        }
      }
    };

    return handler;
  }, [upsertTransfer, addLog, calcSpeed]);

  const startHeartbeat = useCallback((socket: WebSocket) => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, HEARTBEAT_MS);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
  }, []);

  const connectSocket = useCallback((config: { roomName: string; isPublic: boolean; genre: string; username: string }, savedHostId?: string) => {
    const socket = new WebSocket(getWsUrl());
    socketRef.current = socket;

    socket.onopen = () => {
      setReconnecting(false);
      startHeartbeat(socket);
      addLog("WebSocket connected", "success");
      if (savedHostId) {
        socket.send(JSON.stringify({ type: "reconnect-host", roomId: savedHostId }));
      } else {
        socket.send(JSON.stringify({ type: "create-room", ...config }));
      }
    };

    socket.onerror = () => addLog("WebSocket error", "error");

    socket.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "pong") return;
      if (msg.type === "host-id") {
        setHostId(msg.hostId);
        addLog(`Room created: ${msg.hostId.slice(0, 8)}...`, "success");
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, hostId: msg.hostId })); } catch {}
      } else if (msg.error && savedHostId) {
        socket.send(JSON.stringify({ type: "create-room", ...config }));
      } else if (msg.type === "new-member") {
        const { offer, memberId, username: mu } = msg;
        if (mu) userIdToUsernameRef.current.set(memberId, mu);
        setMembers((p) => p.includes(memberId) ? p : [...p, memberId]);
        addLog(`Peer connected: ${mu || memberId.slice(0, 8)}`, "success");
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        const dcs: RTCDataChannel[] = [];
        peerConnectionsRef.current.set(memberId, { pc, dataChannels: dcs });
        pc.ondatachannel = (ev) => {
          const dc = ev.channel; dc.binaryType = "arraybuffer";
          dc.onmessage = makeReceiveHandler(memberId);
          dcs.push(dc);
        };
        pc.onicecandidate = (ev) => {
          if (ev.candidate) socket.send(JSON.stringify({ type: "ice-candidate", candidate: ev.candidate, targetId: memberId }));
        };
        try {
          await pc.setRemoteDescription(offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.send(JSON.stringify({ type: "create-answer", answer, targetId: memberId }));

          const pending = pendingIceRef.current.get(memberId) || [];
          for (const c of pending) { try { await pc.addIceCandidate(c); } catch {} }
          pendingIceRef.current.delete(memberId);
        } catch (err) { console.error("answer err", err); }
      } else if (msg.type === "ice-candidate") {
        const conn = peerConnectionsRef.current.get(msg.senderId);
        if (conn && conn.pc) {
          if (!conn.pc.remoteDescription) {
            if (!pendingIceRef.current.has(msg.senderId)) pendingIceRef.current.set(msg.senderId, []);
            pendingIceRef.current.get(msg.senderId)!.push(new RTCIceCandidate(msg.candidate));
          } else {
            try { await conn.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
          }
        }
      } else if (msg.type === "disconnected") {
        setMembers(p => p.filter(id => id !== msg.memberId));
        peerConnectionsRef.current.get(msg.memberId)?.pc.close();
        peerConnectionsRef.current.delete(msg.memberId);
        
        const state = receiverStateRef.current.get(msg.memberId);
        if (state && !state.cancelled) {
          state.cancelled = true;
          if (state.tid) {
             upsertTransfer({ id: state.tid, peerId: msg.memberId, name: state.meta?.name ?? "", size: state.meta?.size ?? 0, progress: 0, direction: "receive", status: "error", paused: false });
          }
          if (state.fileStream) { state.fileStream.close().catch(()=>{}); }
        }
        receiverStateRef.current.delete(msg.memberId);
        setTransfers(p => p.map(t => t.peerId === msg.memberId && t.status === "active" ? { ...t, status: "error" } : t));

        addLog(`Peer disconnected: ${userIdToUsernameRef.current.get(msg.memberId) || msg.memberId.slice(0, 8)}`, "info");
      } else if (msg.type === "chat-message") {
        setChatMessages((p) => [...p, { senderId: msg.senderId, text: msg.text, timestamp: msg.timestamp }]);
      }
    };

    socket.onclose = () => {
      stopHeartbeat();
      if (intentionalCloseRef.current) return;
      addLog("Connection lost, reconnecting...", "warn");
      setReconnecting(true);
      const stored = (() => { try { const s = sessionStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } })();
      reconnectTimerRef.current = setTimeout(() => connectSocket(config, stored?.hostId), 2000);
    };
  }, [makeReceiveHandler, startHeartbeat, stopHeartbeat, addLog]);

  useEffect(() => {
    const stored = (() => { try { const s = sessionStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } })();
    let config: { roomName: string; isPublic: boolean; genre: string; username: string };
    let savedHostId: string | undefined;

    if (location.state) {
      const { roomName, isPublic, genre, username } = location.state as any;
      config = { roomName, isPublic, genre, username };
    } else if (stored) {
      config = stored; savedHostId = stored.hostId;
    } else {
      navigate("/"); return;
    }
    setRoomInfo(config);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const ws = socketRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          setReconnecting(true);
          const s = (() => { try { const x = sessionStorage.getItem(STORAGE_KEY); return x ? JSON.parse(x) : null; } catch { return null; } })();
          connectSocket(config, s?.hostId);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    const handleWindowDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.types.includes("Files")) setGlobalDrag(true);
    };
    window.addEventListener("dragenter", handleWindowDragEnter);
    connectSocket(config, savedHostId);

    return () => {
      intentionalCloseRef.current = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("dragenter", handleWindowDragEnter);
      stopHeartbeat();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      peerConnectionsRef.current.forEach(({ pc }) => pc.close());
      peerConnectionsRef.current.clear();
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const closeRoom = () => {
    intentionalCloseRef.current = true;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "close-room" }));
    }
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
    navigate("/");
  };

  const sendFiles = async (peerId: string, files: File[]) => {
    const conn = peerConnectionsRef.current.get(peerId);
    if (!conn || conn.dataChannels.length === 0) {
      addLog(`Cannot send: Connection not ready for ${peerId}`, "error");
      return;
    }
    const dcs = conn.dataChannels;

    const ensureOpen = async () => {
      const waitPromises = dcs.map((dc) => {
        if (dc.readyState === "open") return Promise.resolve();
        return new Promise<void>((r) => {
          const t = setTimeout(r, 3000);
          dc.onopen = () => { clearTimeout(t); r(); };
        });
      });
      await Promise.all(waitPromises);
      if (dcs.every(dc => dc.readyState !== "open")) throw new Error("No channels established over network.");
    };

    for (const file of files) {
      const tid = `send-${peerId}-${file.name}-${Date.now()}`;
      transferStartRef.current.set(tid, Date.now());
      upsertTransfer({ id: tid, peerId, name: file.name, size: file.size, progress: 0, direction: "send", status: "active", paused: false });
      addLog(`SEND → ${file.name} (${formatBytes(file.size)})`, "info");
      const filePath = (file as any).webkitRelativePath || file.name;
      try {
        await ensureOpen();
        const { promise, control } = sendFileOverChannels(file, dcs, filePath, (sent, total) => {
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
    addLog(`Transfer paused`, "warn");
  };
  const resumeTransfer = (tid: string) => {
    sendControlsRef.current.get(tid)?.resume();
    setTransfers((p) => p.map((t) => t.id === tid ? { ...t, paused: false } : t));
    addLog(`Transfer resumed`, "info");
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
    if (members.length === 0) return;
    const items = e.dataTransfer.items;
    let files: File[] = [];
    if (items && items.length > 0) files = await getFilesFromDataTransfer(items);
    else files = Array.from(e.dataTransfer.files);
    
    if (files.length > 0) {
      members.forEach((peerId) => sendFiles(peerId, files));
    }
  };

  const copyHostId = () => {
    const url = `${window.location.origin}/join?id=${hostId}`;
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const sendMessage = () => {
    if (newMessage.trim() && socketRef.current) {
      socketRef.current.send(JSON.stringify({ type: "chat-message", text: newMessage.trim() }));
      setNewMessage("");
    }
  };

  const activeTransfers = transfers.filter((t) => t.status === "active");
  const doneTransfers = transfers.filter((t) => t.status !== "active");

  return (
    <div className="w-full min-h-screen bg-cyber-black grid-bg">
      <AnimatePresence>
        {globalDrag && members.length > 0 && (
          <motion.div 
            onDragLeave={(e) => { e.preventDefault(); setGlobalDrag(false); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleGlobalDrop}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-cyber-black/90 backdrop-blur-sm border-4 border-dashed border-neon-green flex flex-col items-center justify-center pointer-events-auto"
          >
            <div className="w-32 h-32 mb-6 border-2 border-neon-green flex items-center justify-center rounded-full animate-pulse-slow box-glow pointer-events-none">
              <span className="text-neon-green text-5xl">↓</span>
            </div>
            <h2 className="text-4xl font-display text-neon-green text-glow mb-2 pointer-events-none">RELEASE TO BEAM</h2>
            <p className="text-neon-green/60 font-mono tracking-widest uppercase pointer-events-none">Sending to {members.length} connected peer{members.length !== 1 ? "s" : ""}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reconnecting banner */}
      <AnimatePresence>
        {reconnecting && (
          <motion.div
            initial={{ y: -40 }} animate={{ y: 0 }} exit={{ y: -40 }}
            className="fixed top-0 left-0 right-0 z-50 bg-neon-amber/10 border-b border-neon-amber/30 text-neon-amber text-center text-xs py-2 font-mono uppercase tracking-wider"
          >
            ▸ RECONNECTING — RESTORING SESSION…
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header bar */}
      <div className="bg-cyber-surface border-b border-neon-green/20 py-4 px-4 sm:px-6" style={{ marginTop: reconnecting ? "2rem" : 0 }}>
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-neon-green/40 text-[10px] font-mono uppercase tracking-[0.3em] mb-0.5">// HOST MODE</p>
            <h1 className="text-lg font-display text-neon-green text-glow">
              HOSTING <span className="text-neon-cyan">{roomInfo ? roomInfo.roomName.toUpperCase() : "ROOM"}</span>
            </h1>
            <p className="text-[10px] font-mono text-neon-green/60 mt-1 flex items-center gap-1">
              <span className="w-1 h-1 bg-neon-green rounded-full pulse-dot"></span>
              END-TO-END ENCRYPTED (DTLS)
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 border border-neon-green/20 bg-cyber-black px-3 py-2">
              <span className="text-neon-green/40 text-[10px] font-mono">LINK:</span>
              <span className="font-mono text-xs text-neon-green truncate max-w-[180px]">{hostId || "…"}</span>
              <button onClick={copyHostId} className="p-1 border border-neon-green/20 hover:border-neon-green hover:bg-neon-green/10 transition-all">
                <span className="text-neon-green text-[10px]">{copied ? "✓" : "⧉"}</span>
              </button>
            </div>
            <button onClick={closeRoom} className="btn-danger text-xs">✕ CLOSE</button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">

          {/* Members */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title flex items-center gap-2">
                <span className="text-neon-green">⬡</span> CONNECTED PEERS
              </h2>
              <span className="badge border-neon-green/30 text-neon-green">{members.length}</span>
            </div>
            {members.length === 0 ? (
              <div className="border border-dashed border-cyber-darkgray p-10 text-center">
                <p className="text-cyber-gray text-xs font-mono">NO PEERS CONNECTED</p>
                <p className="text-cyber-darkgray text-[10px] font-mono mt-1">Share your Host ID to let others join</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {members.map((memberId) => (
                  <li key={memberId}
                    className={`border p-4 transition-all duration-150 border-cyber-darkgray/40 hover:border-cyber-darkgray`}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-neon-green rounded-full pulse-dot" />
                        <Toggleable username={userIdToUsernameRef.current.get(memberId) || "Unknown"} userId={memberId} />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openPicker(memberId, false)} className="btn-primary text-[10px] px-3 py-1.5">
                          FILE
                        </button>
                        <button onClick={() => openPicker(memberId, true)} className="btn-secondary text-[10px] px-3 py-1.5">
                          FOLDER
                        </button>
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
                        <div
                          className={`progress-bar-fill ${t.paused ? "bg-neon-amber" : "bg-neon-green"}`}
                          style={{ width: `${t.progress}%` }}
                        />
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

          {/* Completed Transfers */}
          {doneTransfers.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title flex items-center gap-2 mb-4">
                ✓ TRANSFER LOG
              </h2>
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
            <h2 className="section-title flex items-center gap-2 mb-4">
              &gt;_ ACTIVITY LOG
            </h2>
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
          <h2 className="section-title flex items-center gap-2 mb-4">
            ⬡ ROOM CHAT
          </h2>
          <div className="flex-1 overflow-y-auto space-y-2.5 mb-4 -mr-1 pr-1">
            {chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-cyber-darkgray text-xs font-mono">
                NO MESSAGES
              </div>
            ) : chatMessages.map((msg, i) => {
              const isHost = msg.senderId === hostId;
              return (
                <div key={i} className={`flex flex-col ${isHost ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[85%] px-3 py-2 ${isHost ? "bg-neon-green/10 border border-neon-green/20 text-neon-green" : "bg-cyber-surface border border-cyber-darkgray text-cyber-light"}`}>
                    <p className={`text-[10px] font-mono font-bold mb-0.5 ${isHost ? "text-neon-green/50" : "text-cyber-darkgray"}`}>
                      {isHost ? "YOU" : (userIdToUsernameRef.current.get(msg.senderId) || "UNKNOWN")}
                    </p>
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
    </div>
  );
};

export default Host;
