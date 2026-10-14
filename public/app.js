import { PeerLink } from "./rtc.js?v=5";
import { createReceiver, sendFile } from "./transfer.js?v=2";

const homeView = document.querySelector("#home-view");
const roomView = document.querySelector("#room-view");
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
const fileInput = document.querySelector("#file-input");
const fileHistory = document.querySelector("#file-history");

let socket;
let roomCode;
let peerLink;
let receiver;

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
  setStatus("Aguardando outro dispositivo...", "waiting");
  connectionType.classList.add("hidden");
  connectionType.textContent = "";
  transferArea.classList.add("hidden");
  fileHistory.replaceChildren();
  setNotice(roomNotice, "");
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
    setNotice(roomNotice, "O outro dispositivo saiu da sala.");
    return;
  }

  if (message.type === "error") {
    const errorMessage = message.reason === "room-full"
      ? "Essa sala já está cheia."
      : "Sala não encontrada.";
    setStatus(errorMessage, "error");
    setNotice(roomNotice, errorMessage);
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
    onClose: () => {
      setStatus("Aguardando outro dispositivo...", "waiting");
      connectionType.classList.add("hidden");
    },
    onMessage: (data) => {
      if (data === "ping") {
        setNotice(roomNotice, "Ping recebido: conexão funcionando.");
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
    const download = document.createElement("a");
    download.href = URL.createObjectURL(blob);
    download.download = metadata.name;
    download.textContent = "Baixar";
    download.className = "download-link";
    result.append(" ", download);
  }
}

async function sendSelectedFile(file) {
  if (!file || !peerLink) return;
  try {
    let item;
    await sendFile(peerLink, file, (progress) => {
      if (!item) item = createTransferItem(progress, "send");
      item.classList.add("file-item-active");
      item.querySelector("progress").value = progress.percent;
      item.querySelector(".file-progress").textContent = `${progress.percent}%`;
    });
    item.classList.remove("file-item-active");
    item.classList.add("file-item-complete");
    item.querySelector(".file-result").textContent = "Enviado";
    item.querySelector(".file-result").className = "file-result file-success";
  } catch (error) {
    setNotice(roomNotice, `Não foi possível enviar o arquivo: ${error.message}`);
  }
}

function connectToRoom({ create, room }) {
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
    setNotice(roomNotice, "Não foi possível conectar ao servidor.");
  });

  socket.addEventListener("close", () => {
    if (!roomView.classList.contains("hidden")) {
      setStatus("Conexão encerrada", "error");
      setNotice(roomNotice, "A conexão com o servidor foi encerrada.");
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
  const [file] = fileInput.files;
  sendSelectedFile(file);
  fileInput.value = "";
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
  sendSelectedFile(event.dataTransfer.files[0]);
});

const initialRoom = new URLSearchParams(location.search).get("room");
if (initialRoom) {
  joinRoom(initialRoom);
}
