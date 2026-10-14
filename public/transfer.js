const CHUNK_SIZE = 16 * 1024;
const BUFFER_LIMIT = 1024 * 1024;

function waitForBuffer(channel) {
  if (channel.bufferedAmount <= BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve) => {
    const onLow = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", onLow);
  });
}

export function setupTransfer(channel, { onReceive, onProgress }) {
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = BUFFER_LIMIT;
  let incoming;

  channel.onmessage = ({ data }) => {
    if (typeof data === "string") {
      const message = JSON.parse(data);
      if (message.t === "meta") incoming = { ...message, chunks: [], received: 0 };
      if (message.t === "end" && incoming) {
        const transfer = incoming;
        incoming = undefined;
        onReceive(transfer, new Blob(transfer.chunks, { type: transfer.mime }));
      }
      return;
    }

    if (!incoming) return;
    incoming.chunks.push(data);
    incoming.received += data.byteLength;
    onProgress(incoming.id, incoming.received, incoming.size, false);
  };
}

export async function sendFile(channel, file, onProgress) {
  const id = crypto.randomUUID();
  channel.send(JSON.stringify({ t: "meta", id, name: file.name, size: file.size, mime: file.type }));
  let sent = 0;

  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    await waitForBuffer(channel);
    const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    channel.send(chunk);
    sent += chunk.byteLength;
    onProgress(id, sent, file.size, true);
  }

  channel.send(JSON.stringify({ t: "end", id }));
  return id;
}
