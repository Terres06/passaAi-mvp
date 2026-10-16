import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const webSocketServer = new WebSocketServer({ noServer: true });
const rooms = new Map();
const port = Number(process.env.PORT) || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/fflate", express.static(path.join(__dirname, "node_modules", "fflate", "esm")));

function getLanIp() {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return "127.0.0.1";
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function createRoomCode() {
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    if (!rooms.has(code)) {
      return code;
    }
  }

  throw new Error("Não foi possível criar uma sala.");
}

function leaveRoom(socket) {
  if (!socket.room) {
    return;
  }

  const room = socket.room;
  const peers = rooms.get(room);
  if (!peers) {
    socket.room = undefined;
    return;
  }

  peers.delete(socket);
  socket.room = undefined;

  for (const peer of peers) {
    send(peer, { type: "peer-left" });
  }

  if (peers.size === 0) {
    rooms.delete(room);
  }
}

app.get("/api/info", (request, response) => {
  response.json({ lanOrigin: `http://${getLanIp()}:${port}` });
});

app.get("/api/qr", async (request, response) => {
  const text = typeof request.query.text === "string" ? request.query.text : "";

  if (!text) {
    response.status(400).json({ error: "O parâmetro text é obrigatório." });
    return;
  }

  try {
    const image = await QRCode.toBuffer(text, { type: "png" });
    response.type("png").send(image);
  } catch (error) {
    console.error("Erro ao gerar QR code:", error);
    response.status(500).json({ error: "Não foi possível gerar o QR code." });
  }
});

webSocketServer.on("connection", (socket) => {
  socket.on("message", (rawMessage) => {
    let message;

    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      return;
    }

    if (message.type === "create") {
      if (socket.room) {
        return;
      }

      const room = createRoomCode();
      rooms.set(room, new Set([socket]));
      socket.room = room;
      send(socket, { type: "created", room });
      return;
    }

    if (message.type === "join") {
      if (socket.room || typeof message.room !== "string") {
        return;
      }

      const room = message.room.trim();
      if (!/^\d{4}$/.test(room)) {
        send(socket, { type: "error", reason: "room-not-found" });
        return;
      }
      const peers = rooms.get(room);

      if (!peers) {
        send(socket, { type: "error", reason: "room-not-found" });
        return;
      }

      if (peers.size >= 2) {
        send(socket, { type: "error", reason: "room-full" });
        return;
      }

      peers.add(socket);
      socket.room = room;
      send(socket, { type: "joined", room });

      for (const peer of peers) {
        send(peer, { type: "peer-joined" });
      }
      return;
    }

    if (message.type === "signal" && socket.room) {
      const peers = rooms.get(socket.room);
      if (!peers) {
        return;
      }

      for (const peer of peers) {
        if (peer !== socket) {
          send(peer, { type: "signal", data: message.data });
        }
      }
    }
  });

  socket.on("close", () => {
    leaveRoom(socket);
  });
});

server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/ws") {
    socket.destroy();
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit("connection", webSocket, request);
  });
});

server.listen(port, "0.0.0.0", () => {
  const lanOrigin = `http://${getLanIp()}:${port}`;
  console.log(`Local: http://localhost:${port}`);
  console.log(`LAN:   ${lanOrigin}`);
});