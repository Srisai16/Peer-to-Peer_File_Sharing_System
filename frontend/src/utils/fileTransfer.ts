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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const BUFFER_THRESHOLD = 8 * 1024 * 1024; // 8MB — pause sending above this

export const sendFileOverChannel = (
  file: File,
  dataChannel: RTCDataChannel,
  filePath: string,
  onProgress: (sent: number, total: number) => void
): { promise: Promise<void>; control: TransferControl } => {
  let cancelled = false;
  let paused = false;
  let resumeFn: (() => void) | null = null;

  const control: TransferControl = {
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      const fn = resumeFn;
      resumeFn = null;
      fn?.();
    },
    cancel: () => {
      cancelled = true;
      paused = false;
      const fn = resumeFn;
      resumeFn = null;
      fn?.();
      if (dataChannel.readyState === "open") {
        try { dataChannel.send(JSON.stringify({ type: "transfer-cancelled" })); } catch {}
      }
    },
  };

  const promise = (async () => {
    const meta: FileMeta = {
      type: "file-meta",
      name: file.name,
      path: filePath,
      size: file.size,
    };
    dataChannel.send(JSON.stringify(meta));

    const reader = file.stream().getReader();
    let offset = 0;

    while (true) {
      if (cancelled) {
        reader.cancel();
        return;
      }

      if (paused) {
        await new Promise<void>((r) => { resumeFn = r; });
        if (cancelled) { reader.cancel(); return; }
      }

      while (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
        await sleep(10);
        if (cancelled) { reader.cancel(); return; }
      }

      if (dataChannel.readyState !== "open") {
        throw new Error("Data channel closed during transfer");
      }

      const { done, value } = await reader.read();
      if (done) break;

      dataChannel.send(value);
      offset += value.byteLength;
      onProgress(offset, file.size);
    }

    dataChannel.send(JSON.stringify({ type: "EOF" }));
  })();

  return { promise, control };
};
