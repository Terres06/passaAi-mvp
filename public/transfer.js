// Tamanho de cada fatia do arquivo (16 KB é o tamanho seguro padrão para WebRTC DataChannel)
const CHUNK_SIZE = 16 * 1024;
// Limite máximo do buffer de envio (1 MB) para evitar estouro de memória no navegador
const BUFFER_LIMIT = 1024 * 1024;

/**
 * Gera um identificador único para a transferência usando crypto ou fallback com timestamp.
 */
function createTransferId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const values = new Uint32Array(3);
    cryptoApi.getRandomValues(values);
    return `${values[0].toString(36)}-${values[1].toString(36)}-${values[2].toString(36)}`;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Controle de fluxo (backpressure): pausa o envio se o buffer do canal estiver cheio
 * e só continua quando o evento 'bufferedamountlow' indicar que há espaço livre.
 */
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

/**
 * Transmite um arquivo via canal WebRTC fatiando-o em pequenos pedaços binários.
 * 1. Envia metadados (JSON).
 * 2. Envia os pedaços (ArrayBuffer de 16 KB) respeitando o buffer.
 * 3. Envia mensagem de encerramento (JSON).
 */
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

  // Define o limiar em que o canal dispara o evento de buffer liberado
  channel.bufferedAmountLowThreshold = BUFFER_LIMIT;
  peerLink.send(JSON.stringify(metadata));
  onProgress({ ...metadata, received: 0, percent: 0 });

  // Fatiamento e envio progressivo
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

  // Aguarda esvaziar o buffer antes de sinalizar a conclusão
  await waitForBuffer(channel);
  peerLink.send(JSON.stringify({ t: "end", id }));
}

/**
 * Cria a função receptora que processa dados recebidos do canal P2P.
 * Reconstrói o arquivo juntando os chunks binários e valida a integridade final.
 */
export function createReceiver(onProgress, onComplete, onError) {
  let incoming; // Armazena o estado do arquivo que está sendo recebido atualmente

  return (data) => {
    try {
      // Mensagens de texto representam controle (metadados ou sinal de fim)
      if (typeof data === "string") {
        const message = JSON.parse(data);

        // Início da transferência: recebe nome, tamanho e tipo do arquivo
        if (message.t === "meta") {
          if (incoming) {
            throw new Error("Já existe um arquivo sendo recebido.");
          }
          if (!message.id || typeof message.name !== "string"
            || !Number.isFinite(message.size) || message.size < 0) {
            throw new Error("Metadados de arquivo inválidos.");
          }
          incoming = {
            ...message,
            name: message.name,
            chunks: [],
            received: 0,
          };
        } else if (message.t === "end") {
          // Fim da transferência: reconstrói o Blob e verifica tamanho
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

      // Dados binários representam fatias (chunks) do arquivo
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
