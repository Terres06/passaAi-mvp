const homeView = document.querySelector("#home-view");
const roomView = document.querySelector("#room-view");
const createRoomButton = document.querySelector("#create-room");
const showJoinButton = document.querySelector("#show-join");
const joinForm = document.querySelector("#join-form");
const roomInput = document.querySelector("#room-code");
const roomCodeDisplay = document.querySelector("#room-code-display");
const qrCode = document.querySelector("#qr-code");
const connectionStatus = document.querySelector("#connection-status");
const homeNotice = document.querySelector("#home-notice");
const roomNotice = document.querySelector("#room-notice");
const leaveRoomButton = document.querySelector("#leave-room");

let socket;
let roomCode;

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
    setStatus("Dispositivo conectado", "connected");
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

function connectToRoom({ create, room }) {
  socket = new WebSocket(getWebSocketUrl());

  socket.addEventListener("open", () => {
    const message = create ? { type: "create" } : { type: "join", room };
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
  if (socket) socket.close();
  location.href = "/";
});

const initialRoom = new URLSearchParams(location.search).get("room");
if (initialRoom) {
  joinRoom(initialRoom);
}
