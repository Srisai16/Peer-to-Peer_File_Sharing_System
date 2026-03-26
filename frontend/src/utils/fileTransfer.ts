export interface FileMeta {
  type: "file-meta";
  name: string;
  path: string;
  size: number;
}

export interface TransferControl {
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const getFilesFromDataTransfer = async (itemList: DataTransferItemList): Promise<File[]> => {
  const files: File[] = [];
  const queue: any[] = [];
  
  for (let i = 0; i < itemList.length; i++) {
    const item = itemList[i].webkitGetAsEntry();
    if (item) queue.push(item);
  }

  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) continue;

    if (entry.isFile) {
      const file = await new Promise<File>((resolve) => (entry as any).file(resolve));
      Object.defineProperty(file, 'webkitRelativePath', {
        value: entry.fullPath.substring(1),
        writable: false
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as any).createReader();
      const readEntries = () => new Promise<any[]>((resolve, reject) => reader.readEntries(resolve, reject));
      
      let entries: any[] = [];
      let readResult;
      do {
        readResult = await readEntries();
        entries.push(...readResult);
      } while (readResult.length > 0);
      
      queue.push(...entries);
    }
  }

  return files;
};


const BUFFER_THRESHOLD = 8 * 1024 * 1024; // 8MB Maximum Saturation Buffer

export const sendFileOverChannels = (
  file: File,
  dataChannels: RTCDataChannel[],
  filePath: string,
  onProgress: (sent: number, total: number) => void
): { promise: Promise<void>; control: TransferControl } => {
  let cancelled = false;
  let paused = false;
  let resumeFn: (() => void) | null = null;

  const control: TransferControl = {
    pause: () => { paused = true; },
    resume: () => { paused = false; const fn = resumeFn; resumeFn = null; fn?.(); },
    cancel: () => {
      cancelled = true; paused = false; const fn = resumeFn; resumeFn = null; fn?.();
      dataChannels[0]?.readyState === "open" && dataChannels[0].send(JSON.stringify({ type: "transfer-cancelled" }));
    },
  };

  dataChannels.forEach(dc => dc.bufferedAmountLowThreshold = 2 * 1024 * 1024);

  const promise = (async () => {
    const meta: FileMeta = { type: "file-meta", name: file.name, path: filePath, size: file.size };
    dataChannels[0].send(JSON.stringify(meta)); // Metadata strictly runs over Channel 0

    const reader = file.stream().getReader();
    let offset = 0;
    const CHUNK_SIZE = 128 * 1024; 
    let lastProgressTime = 0;
    let channelRotate = 0;

    const waitForAnyChannel = () => {
      return new Promise<void>((resolve) => {
        const listeners: { dc: RTCDataChannel; fn: () => void }[] = [];
        const cleanup = () => listeners.forEach(({ dc, fn }) => dc.removeEventListener("bufferedamountlow", fn));
        
        for (const dc of dataChannels) {
          if (dc.bufferedAmount <= dc.bufferedAmountLowThreshold) {
            cleanup(); resolve(); return;
          }
          const fn = () => { cleanup(); resolve(); };
          dc.addEventListener("bufferedamountlow", fn);
          listeners.push({ dc, fn });
        }
      });
    };

    while (true) {
      if (cancelled) { reader.cancel(); return; }
      const { done, value } = await reader.read();
      if (done) break;

      let chunkOffset = 0;
      while (chunkOffset < value.byteLength) {
        if (cancelled) { reader.cancel(); return; }
        if (paused) { await new Promise<void>((r) => { resumeFn = r; }); if (cancelled) return; }

        let dcIndex = -1;
        for (let i = 0; i < dataChannels.length; i++) {
          const idx = (channelRotate + i) % dataChannels.length;
          if (dataChannels[idx].readyState === "open" && dataChannels[idx].bufferedAmount <= BUFFER_THRESHOLD) {
            dcIndex = idx; break;
          }
        }

        if (dcIndex === -1) {
          await waitForAnyChannel();
          if (cancelled) { reader.cancel(); return; }
          continue;
        }

        channelRotate = (dcIndex + 1) % dataChannels.length;
        const dc = dataChannels[dcIndex];

        const end = Math.min(chunkOffset + CHUNK_SIZE, value.byteLength);
        const chunk = value.slice(chunkOffset, end);
        
        // Multiplexing Header Injection (8 Bytes Double Float Offset + Binary)
        const payload = new Uint8Array(8 + chunk.byteLength);
        const view = new DataView(payload.buffer);
        view.setFloat64(0, offset, true); // Little Endian
        payload.set(new Uint8Array(chunk), 8);

        dc.send(payload);
        
        chunkOffset += chunk.byteLength;
        offset += chunk.byteLength;

        const now = Date.now();
        if (now - lastProgressTime > 50 || offset === file.size) {
          onProgress(offset, file.size);
          lastProgressTime = now;
        }
      }
    }

    dataChannels[0].send(JSON.stringify({ type: "EOF" }));
  })();

  return { promise, control };
};
