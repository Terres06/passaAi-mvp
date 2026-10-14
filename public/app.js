import { createAnswer, createOffer, createPeerConnection } from "./rtc.js";
import { sendFile, setupTransfer } from "./transfer.js";

const homeView = document.querySelector("#home-view");
const roomView = document.querySelector("#room-view");
const createButton = document.querySelector("#create-room");
const joinForm = document.querySelector("#join-form");
const showJoinButton = document.querySelector("#show-join");
const roomInput = document.querySelector("#room-code");
const roomDisplay = document.querySelector("#room-code-display");
const status = document.querySelector("#connection-status");
const inviteArea = document.querySelector("#invite-area");
const transferArea = document.querySelector("#transfer-area");
const qrCode = document.querySelector("#qr-code");
const fileInput = document.querySelector("#file-input");
const transfers = document.querySelector("#transfers");
const notice = document.querySelector("#notice");
const leaveButton = document.querySelector("#leave-room");

let socket;
let peer;
let channel;
let room;
let isCaller = false;
const transferElements = new Map();

function showNotice(message, isError = true) {
  notice.textContent = message;
  notice.className = `notice ${isError ? "notice-error" : "notice-success"}`;
}

function setConnected(nextChannel) {
  channel = nextChannel;
  channel.onopen = () => {
    status.textContent = "Conectado";
    status.className = "status status-connected";
    inviteArea.classList.add("hidden");
    transferArea.classList.remove("hidden");
  };
  channel.onclose = () => {
    status.textContent = "Desconectado";
    status.className = "status status-error";
    transferArea.classList.add("hidden");
    showNotice("A conexão foi encerrada.");
  };
  setupTransfer(channel, {
    onReceive: (metadata, blob) => {
      const item = transferElements.get(metadata.id);
      if (item) item.querySelector(".transfer-state").textContent = "Recebido";
      if (blob.size !== metadata.size) {
        showNotice(`A integridade de "${metadata.name}" foi comprometida.`);
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = metadata.name;
      link.textContent = `Baixar ${metadata.name}`;
      link.className = "download-link";
      (item || transfers).append(link);
    },
    onProgress: updateProgress,
  });
}

function updateProgress(id, current, total, isSending) {
  let item = transferElements.get(id);
  if (!item) {
    item = document.createElement("div");
    item.className = "transfer-item";
    item.innerHTML = `<strong>${isSending ? "Enviando" : "Recebendo"} arquivo</strong><progress max="100" value="0"></progress><span class="transfer-state">0%</span>`;
    transfers.prepend(item);
    transferElements.set(id, item);
  }
  const percent = total ? Math.round((current / total) * 100) : 100;
  item.querySelector("progress").value = percent;
  item.querySelector(".transfer-state").textContent = `${percent}%`;
}

function signal(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "signal", data: message }));
}

async function startPeerConnection(caller) {
  peer = createPeerConnection({
    onDataChannel: setConnected,
    onSignal: signal,
    onStateChange: (state) => {
      if (state === "failed" || state === "disconnected") showNotice("Não foi possível manter a conexão.");
    },
  });
  if (caller) {
    setConnected(peer.createDataChannel("files"));
    signal({ sdp: await createOffer(peer) });
  }
}

function connect(roomCode, caller) {
  room = roomCode;
  isCaller = caller;
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket.onopen = () => socket.send(JSON.stringify({ type: caller ? "create" : "join", room: caller ? undefined : room }));
  socket.onmessage = async ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === "created" || message.type === "joined") {
      room = message.room;
      roomDisplay.textContent = room;
      if (caller) {
        const info = location.hostname === "localhost" || location.hostname === "127.0.0.1"
          ? await fetch("/api/info").then((response) => response.json())
          : { lanOrigin: location.origin };
        qrCode.src = `/api/qr?text=${encodeURIComponent(`${info.lanOrigin}/?room=${room}`)}`;
      }
      return;
    }
    if (message.type === "peer-joined") {
      await startPeerConnection(true);
      return;
    }
    if (message.type === "signal") {
      if (!peer) await startPeerConnection(false);
      if (message.data.sdp) {
        await peer.setRemoteDescription(message.data.sdp);
        if (!isCaller) signal({ sdp: await createAnswer(peer) });
      } else if (message.data.candidate) {
        await peer.addIceCandidate(message.data.candidate);
      }
      return;
    }
    if (message.type === "error") showNotice(message.reason === "room-full" ? "Essa sala já está cheia." : "Sala não encontrada.");
  };
  socket.onclose = () => {
    if (!roomView.classList.contains("hidden")) showNotice("A conexão com o servidor foi encerrada.");
  };
}

function openRoom() {
  homeView.classList.add("hidden");
  roomView.classList.remove("hidden");
  status.textContent = "Aguardando";
  status.className = "status status-waiting";
}

createButton.onclick = () => {
  openRoom();
  connect("", true);
};
showJoinButton.onclick = () => {
  joinForm.classList.remove("hidden");
  roomInput.focus();
};
joinForm.onsubmit = (event) => {
  event.preventDefault();
  if (!/^\d{4}$/.test(roomInput.value)) {
    showNotice("Digite um código de 4 dígitos.");
    return;
  }
  openRoom();
  connect(roomInput.value, false);
};
fileInput.onchange = async () => {
  const [file] = fileInput.files;
  if (!file || !channel || channel.readyState !== "open") return;
  await sendFile(channel, file, updateProgress);
  fileInput.value = "";
};
leaveButton.onclick = () => location.reload();

const initialRoom = new URLSearchParams(location.search).get("room");
if (initialRoom && /^\d{4}$/.test(initialRoom)) {
  roomInput.value = initialRoom;
  openRoom();
  connect(initialRoom, false);
}
