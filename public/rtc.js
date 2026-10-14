const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export class PeerLink {
  constructor(socket, role, callbacks = {}) {
    this.socket = socket;
    this.role = role;
    this.onOpen = callbacks.onOpen;
    this.onClose = callbacks.onClose;
    this.onMessage = callbacks.onMessage;
    this.channel = null;
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    this.closed = false;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal({ candidate });
    };
    this.pc.ondatachannel = ({ channel }) => this.setupChannel(channel);
    this.pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(this.pc.connectionState)) {
        this.close();
      }
    };
    this.socket.addEventListener("message", (event) => {
      try {
        this.handleSocketMessage(JSON.parse(event.data)).catch((error) => {
          console.error("Erro na sinalização WebRTC:", error);
          this.close();
        });
      } catch (error) {
        console.error("Mensagem de sinalização inválida:", error);
        this.close();
      }
    });
  }

  async handleSocketMessage(message) {
    if (message.type === "peer-joined" && this.role === "caller") {
      this.channel = this.pc.createDataChannel("files");
      this.setupChannel(this.channel);
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendSignal({ sdp: this.pc.localDescription });
      return;
    }

    if (message.type !== "signal" || !message.data) return;

    if (message.data.sdp) {
      await this.pc.setRemoteDescription(message.data.sdp);
      this.remoteDescriptionSet = true;
      await this.addPendingCandidates();

      if (this.role === "callee" && message.data.sdp.type === "offer") {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendSignal({ sdp: this.pc.localDescription });
      }
      return;
    }

    if (message.data.candidate) {
      if (this.remoteDescriptionSet) {
        await this.pc.addIceCandidate(message.data.candidate);
      } else {
        this.pendingCandidates.push(message.data.candidate);
      }
    }
  }

  async addPendingCandidates() {
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      await this.pc.addIceCandidate(candidate);
    }
  }

  setupChannel(channel) {
    if (this.channel === channel && channel.readyState === "open") return;
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => this.onOpen?.();
    channel.onclose = () => this.close();
    channel.onerror = () => this.close();
    channel.onmessage = ({ data }) => this.onMessage?.(data);
  }

  sendSignal(data) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "signal", data }));
  }

  send(data) {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("O canal de dados ainda não está conectado.");
    }
    this.channel.send(data);
  }

  async getConnectionType() {
    const stats = await this.pc.getStats();
    let selectedPair;

    for (const report of stats.values()) {
      if (report.type === "transport" && report.selectedCandidatePairId) {
        selectedPair = stats.get(report.selectedCandidatePairId);
        break;
      }
      if (report.type === "candidate-pair" && report.selected) {
        selectedPair = report;
        break;
      }
    }

    if (!selectedPair) return "Local (P2P direto)";
    const localCandidate = stats.get(selectedPair.localCandidateId);
    const remoteCandidate = stats.get(selectedPair.remoteCandidateId);
    const candidateType = localCandidate?.candidateType || remoteCandidate?.candidateType;

    return candidateType === "host"
      ? "Local (P2P direto)"
      : "Via internet (P2P)";
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.channel && this.channel.readyState !== "closed") this.channel.close();
    if (this.pc.signalingState !== "closed") this.pc.close();
    this.onClose?.();
  }
}
