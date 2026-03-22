import { FormEvent, useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Toggleable from "./Toggleable";
import { getWsUrl } from "../utils/wsUrl";
import { sendFileOverChannel, formatBytes, FileMeta, TransferControl } from "../utils/fileTransfer";

interface ChatMessage { senderId: string; text: string; timestamp: number; }
interface Transfer {
  id: string; peerId: string; name: string; size: number;
  progress: number; direction: "send" | "receive"; status: "active" | "done" | "error"; paused: boolean;
}
interface PeerState { pc: RTCPeerConnection; dataChannel: RTCDataChannel | null; }

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
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
  const dragCounterRef = useRef<{ [id: string]: number }>({});
  const [dragOver, setDragOver] = useState<{ [id: string]: boolean }>({});
  const chatEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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

    const cancelFn = () => {
      cancelled = true;
      if (tid) upsertTransfer({ id: tid, peerId, name: meta?.name ?? "", size: meta?.size ?? 0, progress: 0, direction: "receive", status: "error", paused: false });
      meta = null; buffers = [];
    };

    return (ev: MessageEvent) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data);
        if (msg.type === "file-meta") {
          meta = msg as FileMeta; buffers = []; receivedBytes = 0; cancelled = false;
          tid = `recv-${peerId}-${Date.now()}`;
          recvCancelRef.current.set(tid, cancelFn);
          upsertTransfer({ id: tid, peerId, name: meta.name, size: meta.size, progress: 0, direction: "receive", status: "active", paused: false });
        } else if (msg.type === "EOF") {
          if (!cancelled && meta) {
            const blob = new Blob(buffers);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = meta.name;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            upsertTransfer({ id: tid, peerId, name: meta.name, size: meta.size, progress: 100, direction: "receive", status: "done", paused: false });
          }
          meta = null; buffers = []; recvCancelRef.current.delete(tid);
        } else if (msg.type === "transfer-cancelled") {
          cancelled = true;
          if (tid) upsertTransfer({ id: tid, peerId, name: meta?.name ?? "", size: meta?.size ?? 0, progress: 0, direction: "receive", status: "error", paused: false });
          meta = null; buffers = [];
        }
      } else if (ev.data instanceof ArrayBuffer && !cancelled) {
        buffers.push(ev.data); receivedBytes += ev.data.byteLength;
        if (meta) upsertTransfer({ id: tid, peerId, name: meta.name, size: meta.size, progress: Math.round((receivedBytes / meta.size) * 100), direction: "receive", status: "active", paused: false });
      }
    };
  }, [upsertTransfer]);

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

    socket.onopen = () => { setReconnecting(false); startHeartbeat(socket); };
    socket.onerror = (err) => console.error("ws error", err);

    socket.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "pong") return;
      if (msg.type === "userId") { setUserId(msg.userId); }
      else if (msg.type === "new-member") {
        const { memberId, username: mu } = msg;
        if (mu) userIdToUsernameRef.current.set(memberId, mu);
        setRoomMembers((p) => p.includes(memberId) ? p : [...p, memberId]);
      } else if (msg.type === "create-answer") {
        const pc = peerConnectionRef.current.get(msg.senderId)?.pc;
        if (pc) { try { await pc.setRemoteDescription(msg.answer); setIsInRoom(true); } catch {} }
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
        navigate("/");
      } else if (msg.type === "disconnected") {
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
      reconnectTimerRef.current = setTimeout(() => initSocket(), 2000);
    };

    return socket;
  }, [initiatePeerConnection, handlePeerOffer, handlePeerAnswer, startHeartbeat, stopHeartbeat, navigate, isInRoom]);

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
    return () => {
      intentionalCloseRef.current = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      stopHeartbeat();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      peerConnectionRef.current.forEach((v) => v.pc.close());
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const handleJoinRoom = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return alert("Please enter a display name");
    const socket = socketRef.current;
    if (!socket) return;
    try { sessionStorage.setItem(JOIN_KEY, JSON.stringify({ hostId, username })); } catch {}
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
      const filePath = (file as any).webkitRelativePath || file.name;
      try {
        await ensureOpen();
        const { promise, control } = sendFileOverChannel(file, dc, filePath, (sent, total) => {
          upsertTransfer({ id: tid, peerId, name: file.name, size: total, progress: Math.round((sent / total) * 100), direction: "send", status: "active", paused: false });
        });
        sendControlsRef.current.set(tid, control);
        await promise;
        sendControlsRef.current.delete(tid);
        upsertTransfer({ id: tid, peerId, name: file.name, size: file.size, progress: 100, direction: "send", status: "done", paused: false });
      } catch {
        sendControlsRef.current.delete(tid);
        upsertTransfer({ id: tid, peerId, name: file.name, size: file.size, progress: 0, direction: "send", status: "error", paused: false });
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
  };

  const openPicker = (peerId: string, folder = false) => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true;
    if (folder) (input as any).webkitdirectory = true;
    input.onchange = () => { if (input.files) sendFiles(peerId, Array.from(input.files)); };
    input.click();
  };

  const handleDrop = (peerId: string, e: React.DragEvent) => {
    e.preventDefault(); dragCounterRef.current[peerId] = 0;
    setDragOver((p) => ({ ...p, [peerId]: false }));
    const files = Array.from(e.dataTransfer.files);
    if (files.length) sendFiles(peerId, files);
  };
  const handleDragEnter = (peerId: string, e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current[peerId] = (dragCounterRef.current[peerId] || 0) + 1;
    setDragOver((p) => ({ ...p, [peerId]: true }));
  };
  const handleDragLeave = (peerId: string, e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current[peerId] = (dragCounterRef.current[peerId] || 1) - 1;
    if (dragCounterRef.current[peerId] === 0) setDragOver((p) => ({ ...p, [peerId]: false }));
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
    <div className="w-full min-h-screen bg-slate-100">
      {reconnecting && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center text-sm py-2 font-medium flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Reconnecting…
        </div>
      )}

      {!isInRoom && (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="w-full max-w-md animate-slide-up">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-extrabold text-slate-800">Join a Room</h1>
              <p className="text-slate-500 text-sm mt-1">Enter a Host ID or browse public rooms</p>
            </div>
            <div className="card overflow-hidden">
              <div className="flex border-b border-slate-100">
                <button onClick={() => { setEnterID(true); setPublicRoom(false); }} className={`flex-1 py-3.5 text-sm font-semibold transition-all ${enterID ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}>Enter Room ID</button>
                <button onClick={() => { setPublicRoom(true); setEnterID(false); socketRef.current?.send(JSON.stringify({ type: "public-rooms" })); }} className={`flex-1 py-3.5 text-sm font-semibold transition-all ${publicRoom ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}>Public Rooms</button>
              </div>
              {enterID && (
                <form onSubmit={handleJoinRoom} className="p-6 space-y-4">
                  <div><label className="label">Host Room ID</label><input type="text" placeholder="Paste the host ID here" value={hostId} onChange={(e) => setHostId(e.target.value)} required className="input-field" /></div>
                  <div><label className="label">Your Display Name</label><input type="text" placeholder="How others will see you" value={username} onChange={(e) => setUsername(e.target.value)} required className="input-field" /></div>
                  <button type="submit" className="btn-success w-full py-3 text-base">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    Join Room
                  </button>
                </form>
              )}
              {publicRoom && (
                <div className="p-4">
                  {disRoom.filter((r) => r.isPublic).length === 0 ? (
                    <div className="text-center py-10 text-slate-400">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto mb-2 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                      <p className="text-sm">No public rooms available</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {disRoom.filter((r) => r.isPublic).map((room) => (
                        <li key={room.id} className="flex items-center justify-between py-3 px-1">
                          <div><p className="font-semibold text-slate-800 text-sm">{room.name}</p><p className="text-xs text-slate-500 mt-0.5">{room.genre} · {room.users} member{room.users !== 1 ? "s" : ""}</p></div>
                          <button onClick={() => { setHostId(room.id); setEnterID(true); setPublicRoom(false); }} className="btn-primary text-xs px-3 py-1.5">Select</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isInRoom && (
        <>
          <div className="bg-hero-gradient text-white py-5 px-4 sm:px-6" style={{ marginTop: reconnecting ? "2rem" : 0 }}>
            <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-0.5">Member</p>
                <h1 className="text-xl font-bold">Connected as <span className="text-brand-300">{username}</span></h1>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-xl px-3 py-2">
                  <span className="text-white/60 text-xs">Host ID</span>
                  <span className="font-mono text-sm text-white truncate max-w-[160px]">{hostId}</span>
                  <button onClick={() => { navigator.clipboard.writeText(hostId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }} className="p-1 bg-white/15 hover:bg-white/25 rounded-lg transition-colors">
                    {copied ? <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-emerald-300" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    : <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white/70" viewBox="0 0 20 20" fill="currentColor"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" /><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" /></svg>}
                  </button>
                </div>
                <button onClick={leaveRoom} className="btn-danger text-xs">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  Leave Room
                </button>
              </div>
            </div>
          </div>

          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 flex flex-col gap-5">
              {/* Peers */}
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="section-title flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" /></svg>
                    Room Peers
                  </h2>
                  <span className="badge bg-emerald-100 text-emerald-700">{allPeers.length}</span>
                </div>
                {allPeers.length === 0 ? (
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center"><p className="text-slate-500 text-sm">No other peers yet</p></div>
                ) : (
                  <ul className="space-y-3">
                    {allPeers.map((peerId) => (
                      <li key={peerId}
                        onDrop={(e) => handleDrop(peerId, e)} onDragOver={(e) => e.preventDefault()}
                        onDragEnter={(e) => handleDragEnter(peerId, e)} onDragLeave={(e) => handleDragLeave(peerId, e)}
                        className={`rounded-xl border-2 p-4 transition-all duration-150 ${dragOver[peerId] ? "border-emerald-400 bg-emerald-50 shadow-glow" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>
                            </div>
                            <div>
                              <Toggleable username={peerId === hostId ? (userIdToUsernameRef.current.get(peerId) || "Host") : (userIdToUsernameRef.current.get(peerId) || "Unknown")} userId={peerId} />
                              {peerId === hostId && <span className="badge bg-amber-100 text-amber-700 text-[10px] ml-1">HOST</span>}
                            </div>
                            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse-slow" />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => openPicker(peerId, false)} className="btn-success text-xs px-3 py-1.5">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" /></svg>
                              File
                            </button>
                            <button onClick={() => openPicker(peerId, true)} className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-xl transition-all">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
                              Folder
                            </button>
                          </div>
                        </div>
                        {dragOver[peerId] && <div className="mt-3 text-center text-xs text-emerald-600 font-semibold">↓ Drop to send</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Active Transfers */}
              {activeTransfers.length > 0 && (
                <div className="card p-5">
                  <h2 className="section-title flex items-center gap-2 mb-4">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse-slow" />
                    Active Transfers
                  </h2>
                  <ul className="space-y-3">
                    {activeTransfers.map((t) => (
                      <li key={t.id} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`badge flex-shrink-0 ${t.direction === "send" ? "bg-brand-100 text-brand-700" : "bg-emerald-100 text-emerald-700"}`}>
                              {t.direction === "send" ? "↑ OUT" : "↓ IN"}
                            </span>
                            <span className="text-sm font-medium text-slate-700 truncate">{t.name}</span>
                            {t.paused && <span className="badge bg-amber-100 text-amber-700 flex-shrink-0">Paused</span>}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                            <span className="text-xs text-slate-400 mr-1">{formatBytes(t.size)}</span>
                            {t.direction === "send" && (
                              t.paused
                                ? <button onClick={() => resumeTransfer(t.id)} title="Resume" className="p-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                                  </button>
                                : <button onClick={() => pauseTransfer(t.id)} title="Pause" className="p-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                  </button>
                            )}
                            <button onClick={() => cancelTransfer(t)} title="Cancel" className="p-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-600 transition-colors">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="progress-bar-track">
                          <div className={`progress-bar-fill transition-all ${t.paused ? "bg-amber-400" : t.direction === "send" ? "bg-gradient-to-r from-brand-500 to-brand-400" : "bg-gradient-to-r from-emerald-500 to-emerald-400"}`} style={{ width: `${t.progress}%` }} />
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-xs text-slate-400">{formatBytes(Math.round(t.size * t.progress / 100))} / {formatBytes(t.size)}</span>
                          <span className="text-xs font-semibold text-slate-600">{t.progress}%</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Completed Transfers */}
              {doneTransfers.length > 0 && (
                <div className="card p-5">
                  <h2 className="section-title flex items-center gap-2 mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    Completed Transfers
                  </h2>
                  <ul className="divide-y divide-slate-100">
                    {doneTransfers.slice(-10).map((t) => (
                      <li key={t.id} className="flex items-center justify-between py-2.5 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`badge flex-shrink-0 ${t.status === "error" ? "bg-red-100 text-red-600" : t.direction === "send" ? "bg-brand-100 text-brand-700" : "bg-emerald-100 text-emerald-700"}`}>
                            {t.status === "error" ? "✕ ERR" : t.direction === "send" ? "↑ SENT" : "↓ RECV"}
                          </span>
                          <span className="text-sm text-slate-600 truncate">{t.name}</span>
                        </div>
                        <span className="text-xs text-slate-400 flex-shrink-0">{formatBytes(t.size)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Chat */}
            <div className="card p-5 flex flex-col" style={{ minHeight: "420px" }}>
              <h2 className="section-title flex items-center gap-2 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-brand-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" /></svg>
                Room Chat
              </h2>
              <div className="flex-1 overflow-y-auto space-y-2.5 mb-4 -mr-1 pr-1">
                {chatMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                    No messages yet
                  </div>
                ) : chatMessages.map((msg, i) => {
                  const isMe = msg.senderId === userId;
                  return (
                    <div key={i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${isMe ? "bg-brand-600 text-white rounded-tr-sm" : "bg-slate-100 text-slate-800 rounded-tl-sm"}`}>
                        <p className={`text-[10px] font-semibold mb-0.5 ${isMe ? "text-brand-200" : "text-slate-500"}`}>{isMe ? "You" : userIdToUsernameRef.current.get(msg.senderId) || "Unknown"}</p>
                        <p className="text-sm leading-relaxed">{msg.text}</p>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5 px-1">{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2 pt-3 border-t border-slate-100">
                <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Send a message…" className="input-field flex-1 py-2" />
                <button onClick={sendMessage} className="btn-primary px-3 py-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Join;
