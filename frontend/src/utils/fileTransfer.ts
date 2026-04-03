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


const BUFFER_THRESHOLD = 8 * 1024 * 1024;

export const sendFileOverChannels = (
  file: File,
  dataChannels: RTCDataChannel[],
  filePath: string,
  onProgress: (sent: number, total: number) => void
): { promise: Promise<void>; control: TransferControl } => {
  let cancelled = false;
  let paused = false;
  let resumeFn: (() => void) | null = null;
  const dc = dataChannels[0];

  const control: TransferControl = {
    pause: () => { paused = true; },
    resume: () => { paused = false; const fn = resumeFn; resumeFn = null; fn?.(); },
    cancel: () => {
      cancelled = true; paused = false; const fn = resumeFn; resumeFn = null; fn?.();
      dc?.readyState === "open" && dc.send(JSON.stringify({ type: "transfer-cancelled" }));
    },
  };

  dc.bufferedAmountLowThreshold = 4 * 1024 * 1024;

  const promise = (async () => {
    const meta: FileMeta = { type: "file-meta", name: file.name, path: filePath, size: file.size };
    dc.send(JSON.stringify(meta));

    const reader = file.stream().getReader();
    let offset = 0;
    const CHUNK_SIZE = 256 * 1024; 
    let lastProgressTime = 0;

    const waitForBuffer = () => {
      return new Promise<void>((resolve) => {
        let interval: ReturnType<typeof setInterval>;
        const fn = () => { cleanup(); resolve(); };
        const cleanup = () => {
          if (interval) clearInterval(interval);
          dc.removeEventListener("bufferedamountlow", fn);
        };
        
        if (dc.readyState !== "open" || dc.bufferedAmount <= dc.bufferedAmountLowThreshold) {
           return resolve();
        }
        
        dc.addEventListener("bufferedamountlow", fn);
        interval = setInterval(() => {
          if (dc.readyState !== "open" || dc.bufferedAmount <= dc.bufferedAmountLowThreshold) {
             cleanup(); resolve();
          }
        }, 50);
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
        if (dc.readyState !== "open") throw new Error("Channel closed");

        if (dc.bufferedAmount > BUFFER_THRESHOLD) {
          await waitForBuffer();
          if (cancelled) { reader.cancel(); return; }
        }

        const end = Math.min(chunkOffset + CHUNK_SIZE, value.byteLength);
        const chunk = value.slice(chunkOffset, end);
        
        dc.send(chunk);
        
        chunkOffset += chunk.byteLength;
        offset += chunk.byteLength;

        const now = Date.now();
        if (now - lastProgressTime > 50 || offset === file.size) {
          onProgress(offset, file.size);
          lastProgressTime = now;
        }
      }
    }
  })();

  return { promise, control };
};
