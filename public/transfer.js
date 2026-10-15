const CHUNK_SIZE = 16 * 1024;
const BUFFER_LIMIT = 1024 * 1024;

function createTransferId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const values = new Uint32Array(3);
    cryptoApi.getRandomValues(values);
    return `${values[0].toString(36)}-${values[1].toString(36)}-${values[2].toString(36)}`;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function waitForBuffer(channel) {
  if (channel.bufferedAmount <= BUFFER_LIMIT) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const handleLow = () => {
      cleanup();
      resolve();
    };
    const handleClosed = () => {
      cleanup();
      reject(new Error("O canal de transferência foi encerrado."));
    };
    const cleanup = () => {
      channel.removeEventListener("bufferedamountlow", handleLow);
      channel.removeEventListener("close", handleClosed);
    };
    channel.addEventListener("bufferedamountlow", handleLow);
    channel.addEventListener("close", handleClosed);
  });
}

export async function sendFile(peerLink, file, onProgress) {
  const channel = peerLink.getDataChannel();
  const id = createTransferId();
  const metadata = {
    t: "meta",
    id,
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
  };

  channel.bufferedAmountLowThreshold = BUFFER_LIMIT;
  peerLink.send(JSON.stringify(metadata));
  onProgress({ ...metadata, received: 0, percent: 0 });

  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    await waitForBuffer(channel);
    const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    peerLink.send(chunk);
    const sent = offset + chunk.byteLength;
    onProgress({
      ...metadata,
      received: sent,
      percent: file.size === 0 ? 100 : Math.round((sent / file.size) * 100),
    });
  }

  await waitForBuffer(channel);
  peerLink.send(JSON.stringify({ t: "end", id }));
}

export function createReceiver(onProgress, onComplete, onError) {
  let incoming;

  return (data) => {
    try {
      if (typeof data === "string") {
        const message = JSON.parse(data);
        if (message.t === "meta") {
          if (incoming) {
            throw new Error("Já existe um arquivo sendo recebido.");
          }
          if (!message.id || typeof message.name !== "string"
            || !Number.isFinite(message.size) || message.size < 0) {
            throw new Error("Metadados de arquivo inválidos.");
          }
          incoming = { ...message, chunks: [], received: 0 };
        } else if (message.t === "end") {
          if (!incoming || incoming.id !== message.id) {
            throw new Error("Final de arquivo inesperado.");
          }

          const transfer = incoming;
          incoming = undefined;
          const blob = new Blob(transfer.chunks, { type: transfer.mime });
          const isIntact = transfer.received === transfer.size && blob.size === transfer.size;
          onComplete(transfer, blob, isIntact);
        }
        return;
      }

      if (!incoming || !(data instanceof ArrayBuffer)) {
        throw new Error("Chunk de arquivo inesperado.");
      }

      incoming.chunks.push(data);
      incoming.received += data.byteLength;
      onProgress({
        ...incoming,
        percent: incoming.size === 0
          ? 100
          : Math.min(100, Math.round((incoming.received / incoming.size) * 100)),
      });
    } catch (error) {
      incoming = undefined;
      onError(error);
    }
  };
}
