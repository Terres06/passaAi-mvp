import { PeerLink } from "./rtc.js?v=6";
import { createReceiver, sendFile } from "./transfer.js?v=3";
import { zipSync } from "/vendor/fflate/browser.js";

const homeView = document.querySelector("#home-view");
const roomView = document.querySelector("#room-view");
const brand = document.querySelector(".brand");
const createRoomButton = document.querySelector("#create-room");
const showJoinButton = document.querySelector("#show-join");
const joinForm = document.querySelector("#join-form");
const roomInput = document.querySelector("#room-code");
const roomCodeDisplay = document.querySelector("#room-code-display");
const qrCode = document.querySelector("#qr-code");
const connectionStatus = document.querySelector("#connection-status");
const connectionType = document.querySelector("#connection-type");
const homeNotice = document.querySelector("#home-notice");
const roomNotice = document.querySelector("#room-notice");
const leaveRoomButton = document.querySelector("#leave-room");
const transferArea = document.querySelector("#transfer-area");
const dropZone = document.querySelector("#drop-zone");
const chooseFilesButton = document.querySelector("#choose-files");
const fileInput = document.querySelector("#file-input");
const fileHistory = document.querySelector("#file-history");
const downloadAllButton = document.querySelector("#download-all");
const recoveryActions = document.querySelector("#recovery-actions");
const reconnectRoomButton = document.querySelector("#reconnect-room");
const newRoomButton = document.querySelector("#new-room");
const howItWorksButton = document.querySelector("#how-it-works");
const howItWorksModal = document.querySelector("#how-it-works-modal");

let socket;
let roomCode;
let peerLink;
let receiver;
let roomMode;
let retryWithNewRoom = false;
let receivedFileNames = new Map();
const receivedFiles = [];
const sendQueue = [];
let processingQueue = false;

function setNotice(element, message) {
  element.textContent = message;
  element.classList.toggle("hidden", !message);
}

function setStatus(message, type) {
  connectionStatus.textContent = message;
  connectionStatus.className = `status status-${type}`;
}

function openRoomView() {
  homeView.classList.add("hidden");
  roomView.classList.remove("hidden");
  brand.classList.add("hidden");
  setStatus("Aguardando outro dispositivo...", "waiting");
  connectionType.classList.add("hidden");
  connectionType.textContent = "";
  transferArea.classList.add("hidden");
  fileHistory.replaceChildren();
  receivedFileNames = new Map();
  receivedFiles.length = 0;
  downloadAllButton.classList.add("hidden");
  downloadAllButton.textContent = "Baixar todos";
  sendQueue.length = 0;
  recoveryActions.classList.add("hidden");
  setNotice(roomNotice, "");
}

function showRecovery(message) {
  setNotice(roomNotice, message);
  recoveryActions.classList.remove("hidden");
}

function showConnectionFailure() {
  retryWithNewRoom = true;
  setStatus("Falha na conexão direta", "error");
  transferArea.classList.add("hidden");
  setNotice(
    roomNotice,
    "Não foi possível conectar diretamente. Algumas redes (como Wi-Fi de universidades e empresas) bloqueiam a conexão entre aparelhos. Tente na mesma rede doméstica, em um hotspot ou com o outro aparelho em dados móveis.",
  );
  reconnectRoomButton.textContent = "Tentar novamente";
  newRoomButton.classList.add("hidden");
  recoveryActions.classList.remove("hidden");
}

function showDisconnected() {
  retryWithNewRoom = false;
  setStatus("Conexão perdida", "error");
  transferArea.classList.add("hidden");
  setNotice(roomNotice, "Conexão perdida");
  reconnectRoomButton.textContent = "Reconectar";
  newRoomButton.classList.remove("hidden");
  recoveryActions.classList.remove("hidden");
}

function getWebSocketUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

async function getLanOrigin() {
  const isLocalhost = location.hostname === "localhost"
    || location.hostname === "127.0.0.1";

  if (!isLocalhost) return location.origin;

  const response = await fetch("/api/info");
  if (!response.ok) throw new Error("Não foi possível descobrir o endereço da rede.");
  const info = await response.json();
  return info.lanOrigin;
}

async function showRoomDetails() {
  roomCodeDisplay.textContent = roomCode;
  const lanOrigin = await getLanOrigin();
  const joinUrl = `${lanOrigin}/?room=${roomCode}`;
  qrCode.src = `/api/qr?text=${encodeURIComponent(joinUrl)}`;
}

function handleServerMessage(message) {
  if (message.type === "created" || message.type === "joined") {
    roomCode = message.room;
    recoveryActions.classList.add("hidden");
    showRoomDetails().catch(() => {
      setStatus("Erro ao preparar o convite", "error");
      setNotice(roomNotice, "Não foi possível gerar o QR Code da sala.");
    });
    return;
  }

  if (message.type === "peer-joined") {
    return;
  }

  if (message.type === "peer-left") {
    setStatus("Aguardando outro dispositivo...", "waiting");
    showRecovery("O outro dispositivo saiu da sala.");
    return;
  }

  if (message.type === "error") {
    const errorMessage = message.reason === "room-full"
      ? "Essa sala já está cheia."
      : "Sala não encontrada.";
    setStatus(errorMessage, "error");
    showRecovery(errorMessage);
    return;
  }
}

function setupPeerLink(role) {
  receiver = createReceiver(
    updateTransfer,
    completeTransfer,
    (error) => setNotice(roomNotice, `Erro ao receber arquivo: ${error.message}`),
  );
  peerLink = new PeerLink(socket, role, {
    onOpen: async () => {
      setStatus("Conectado via P2P", "connected");
      connectionType.textContent = `Tipo de conexão: ${await peerLink.getConnectionType()}`;
      connectionType.classList.remove("hidden");
      transferArea.classList.remove("hidden");
      peerLink.send("ping");
    },
    onConnectionFailure: showConnectionFailure,
    onDisconnected: showDisconnected,
    onClose: (reason) => {
      if (reason === "failed" || reason === "disconnected") return;
      setStatus("Conexão perdida", "error");
      connectionType.classList.add("hidden");
      transferArea.classList.add("hidden");
      showRecovery("A conexão entre os dispositivos foi encerrada.");
    },
    onMessage: (data) => {
      if (data === "ping") {
        return;
      }
      receiver(data);
    },
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeFileName(name) {
  return name.replace(/[\/\\:*?"<>|]/g, "") || "arquivo";
}

function getDownloadName(originalName) {
  const sanitizedName = sanitizeFileName(originalName);
  const previousDownloads = receivedFileNames.get(sanitizedName) || 0;
  receivedFileNames.set(sanitizedName, previousDownloads + 1);

  if (previousDownloads === 0) return sanitizedName;

  const extensionStart = sanitizedName.lastIndexOf(".");
  const hasExtension = extensionStart > 0 && extensionStart < sanitizedName.length - 1;
  const baseName = hasExtension ? sanitizedName.slice(0, extensionStart) : sanitizedName;
  const extension = hasExtension ? sanitizedName.slice(extensionStart) : "";
  return `${baseName} (${previousDownloads})${extension}`;
}

function updateDownloadAllButton() {
  downloadAllButton.classList.toggle("hidden", receivedFiles.length < 2);
}

function getZipFileName() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const timestamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `PassaAi-${timestamp}.zip`;
}

async function downloadAllFiles() {
  if (receivedFiles.length < 2) return;

  downloadAllButton.disabled = true;
  downloadAllButton.textContent = "Preparando zip...";
  setNotice(roomNotice, "");

  try {
    const zipEntries = Object.create(null);
    for (const file of receivedFiles) {
      zipEntries[file.downloadName] = new Uint8Array(await file.blob.arrayBuffer());
    }

    const zipData = zipSync(zipEntries, { level: 0 });
    const zipUrl = URL.createObjectURL(new Blob([zipData], { type: "application/zip" }));
    const download = document.createElement("a");
    download.href = zipUrl;
    download.download = getZipFileName();
    download.click();
    setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);
  } catch (error) {
    console.error("Erro ao preparar ZIP:", error);
    setNotice(
      roomNotice,
      "Não foi possível preparar o ZIP. Talvez não haja memória suficiente para reunir os arquivos.",
    );
  } finally {
    downloadAllButton.disabled = false;
    downloadAllButton.textContent = "Baixar todos";
  }
}

function createTransferItem(metadata, direction) {
  const item = document.createElement("article");
  item.className = `file-item file-item-${direction === "send" ? "sending" : "receiving"}`;
  item.dataset.transferId = metadata.id;
  const heading = document.createElement("div");
  heading.className = "file-item-heading";
  const name = document.createElement("strong");
  name.textContent = `${direction === "send" ? "Enviando" : "Recebendo"}: ${metadata.name}`;
  const size = document.createElement("span");
  size.className = "file-size";
  size.textContent = formatFileSize(metadata.size);
  heading.append(name, size);

  const progress = document.createElement("progress");
  progress.max = 100;
  progress.value = 0;
  const progressLabel = document.createElement("span");
  progressLabel.className = "file-progress";
  progressLabel.textContent = "0%";
  const result = document.createElement("div");
  result.className = "file-result";
  item.append(heading, progress, progressLabel, result);
  fileHistory.prepend(item);
  return item;
}

function createQueuedItem(file) {
  const item = createTransferItem({
    id: `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    size: file.size,
  }, "send");
  item.classList.add("file-item-queued");
  item.querySelector(".file-progress").textContent = "Na fila";
  item.querySelector(".file-result").textContent = "Aguardando envio";
  return item;
}

function updateTransfer(metadata) {
  let item = fileHistory.querySelector(`[data-transfer-id="${metadata.id}"]`);
  if (!item) item = createTransferItem(metadata, "receive");
  item.classList.add("file-item-active");
  item.querySelector("progress").value = metadata.percent;
  item.querySelector(".file-progress").textContent = `${metadata.percent}%`;
}

function completeTransfer(metadata, blob, isIntact) {
  updateTransfer({ ...metadata, percent: 100 });
  const item = fileHistory.querySelector(`[data-transfer-id="${metadata.id}"]`);
  const result = item.querySelector(".file-result");
  result.textContent = isIntact ? "Íntegro ✓" : "Erro de integridade";
  result.className = `file-result ${isIntact ? "file-success" : "file-error"}`;

  if (isIntact) {
    const downloadName = getDownloadName(metadata.name);
    receivedFiles.push({ blob, downloadName });
    updateDownloadAllButton();
    const download = document.createElement("a");
    download.href = URL.createObjectURL(blob);
    download.download = downloadName;
    download.textContent = "Baixar";
    download.className = "download-link";
    result.append(" ", download);
  }
}

async function processSendQueue() {
  if (processingQueue || !peerLink) return;
  processingQueue = true;

  try {
    while (sendQueue.length > 0) {
      const queuedFile = sendQueue.shift();
      const item = queuedFile.item;
      item.dataset.transferId = `sending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      item.classList.remove("file-item-queued");
      item.classList.add("file-item-active");
      item.querySelector(".file-result").textContent = "Enviando";

      try {
        await sendFile(peerLink, queuedFile.file, (progress) => {
          item.dataset.transferId = progress.id;
          item.querySelector("progress").value = progress.percent;
          item.querySelector(".file-progress").textContent = `${progress.percent}%`;
        });
        item.classList.remove("file-item-active");
        item.classList.add("file-item-complete");
        item.querySelector(".file-progress").textContent = "100%";
        item.querySelector(".file-result").textContent = "Enviado";
        item.querySelector(".file-result").className = "file-result file-success";
      } catch (error) {
        item.classList.remove("file-item-active");
        item.classList.add("file-item-error");
        item.querySelector(".file-result").textContent = "Falha no envio";
        setNotice(roomNotice, `Não foi possível enviar "${queuedFile.file.name}": ${error.message}`);
        break;
      }
    }
  } finally {
    processingQueue = false;
  }
}

function enqueueFiles(fileList) {
  if (!peerLink) return;
  for (const file of fileList) {
    sendQueue.push({ file, item: createQueuedItem(file) });
  }
  processSendQueue();
}

function connectToRoom({ create, room }) {
  roomMode = create ? "create" : "join";
  socket = new WebSocket(getWebSocketUrl());

  socket.addEventListener("open", () => {
    const message = create ? { type: "create" } : { type: "join", room };
    setupPeerLink(create ? "caller" : "callee");
    socket.send(JSON.stringify(message));
  });

  socket.addEventListener("message", (event) => {
    try {
      handleServerMessage(JSON.parse(event.data));
    } catch {
      setStatus("Resposta inválida do servidor", "error");
      setNotice(roomNotice, "Não foi possível interpretar a resposta do servidor.");
    }
  });

  socket.addEventListener("error", () => {
    setStatus("Erro de conexão", "error");
    showRecovery("Não foi possível conectar ao servidor.");
  });

  socket.addEventListener("close", () => {
    if (!roomView.classList.contains("hidden")) {
      setStatus("Conexão encerrada", "error");
      showRecovery("A conexão com o servidor foi encerrada.");
    }
  });
}

function joinRoom(room) {
  if (!/^\d{4}$/.test(room)) {
    setNotice(homeNotice, "Digite um código de 4 dígitos.");
    return;
  }

  roomCode = room;
  openRoomView();
  connectToRoom({ create: false, room });
}

createRoomButton.addEventListener("click", () => {
  openRoomView();
  connectToRoom({ create: true });
});

reconnectRoomButton.addEventListener("click", () => {
  if (retryWithNewRoom) {
    location.href = "/";
    return;
  }
  if (peerLink) peerLink.close();
  if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
  openRoomView();
  connectToRoom({ create: roomMode === "create", room: roomCode });
});

newRoomButton.addEventListener("click", () => {
  if (peerLink) peerLink.close();
  if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
  location.href = "/";
});

howItWorksButton.addEventListener("click", () => {
  howItWorksModal.showModal();
});

showJoinButton.addEventListener("click", () => {
  joinForm.classList.remove("hidden");
  roomInput.focus();
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  joinRoom(roomInput.value.trim());
});

leaveRoomButton.addEventListener("click", () => {
  if (peerLink) peerLink.close();
  if (socket) socket.close();
  location.href = "/";
});

fileInput.addEventListener("change", () => {
  enqueueFiles(fileInput.files);
  fileInput.value = "";
});

chooseFilesButton.addEventListener("click", () => {
  fileInput.click();
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("drop-zone-active");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("drop-zone-active");
  });
}

dropZone.addEventListener("drop", (event) => {
  enqueueFiles(event.dataTransfer.files);
});

downloadAllButton.addEventListener("click", downloadAllFiles);

const initialRoom = new URLSearchParams(location.search).get("room");
if (initialRoom) {
  joinRoom(initialRoom);
}
