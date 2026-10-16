// Servidor STUN público do Google para descobrir o endereço IP público/portas dos dispositivos (NAT traversal)
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * Gerencia o ciclo de vida da conexão WebRTC (Peer-to-Peer) entre dois navegadores.
 * Utiliza o WebSocket existente como canal de sinalização para troca de SDP e ICE candidates.
 */
export class PeerLink {
  constructor(socket, role, callbacks = {}) {
    this.socket = socket; // Conexão WebSocket usada para sinalização
    this.role = role;     // 'caller' (quem criou a sala) ou 'callee' (quem entrou)
    this.onOpen = callbacks.onOpen;       // Disparado quando o canal de dados é estabelecido
    this.onClose = callbacks.onClose;     // Disparado ao fechar a conexão
    this.onConnectionFailure = callbacks.onConnectionFailure;
    this.onDisconnected = callbacks.onDisconnected;
    this.onMessage = callbacks.onMessage; // Disparado ao receber dados pelo canal P2P
    this.channel = null;
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    this.closed = false;
    this.connected = false;
    this.connectionTimer = null;
    this.issueReported = false;

    // Inicializa a instância principal do WebRTC
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Envia candidatos ICE (rotas de rede descobertas) para o outro par via WebSocket
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal({ candidate });
    };

    // No lado que recebe (callee), captura o canal de dados criado pelo caller
    this.pc.ondatachannel = ({ channel }) => this.setupChannel(channel);

    // Monitora falhas ou encerramento da conexão
    this.pc.onconnectionstatechange = () => {
      console.info("WebRTC connectionState:", this.pc.connectionState);
      if (this.pc.connectionState === "failed") {
        this.reportConnectionFailure();
      } else if (this.pc.connectionState === "disconnected" && this.connected) {
        this.reportDisconnected();
      } else if (this.pc.connectionState === "closed") {
        this.close("closed");
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.info("WebRTC iceConnectionState:", this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === "failed") {
        this.reportConnectionFailure();
      } else if (this.pc.iceConnectionState === "disconnected" && this.connected) {
        this.reportDisconnected();
      }
    };

    // Escuta mensagens de sinalização vindas do WebSocket
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

  /**
   * Processa as mensagens de sinalização (SDP e ICE candidates) recebidas pelo WebSocket.
   */
  async handleSocketMessage(message) {
    // Quando o segundo usuário entra na sala, o 'caller' inicia a negociação WebRTC
    if (message.type === "peer-joined") {
      this.startConnectionTimeout();
    }

    if (message.type === "peer-joined" && this.role === "caller") {
      this.channel = this.pc.createDataChannel("files");
      this.setupChannel(this.channel);
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendSignal({ sdp: this.pc.localDescription });
      return;
    }

    if (message.type !== "signal" || !message.data) return;

    // Recebimento de oferta ou resposta SDP
    if (message.data.sdp) {
      await this.pc.setRemoteDescription(message.data.sdp);
      this.remoteDescriptionSet = true;
      // Aplica candidatos ICE que chegaram antes da descrição remota estar pronta
      await this.addPendingCandidates();

      // Se for o receptor e recebeu a oferta, gera e envia a resposta SDP
      if (this.role === "callee" && message.data.sdp.type === "offer") {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendSignal({ sdp: this.pc.localDescription });
      }
      return;
    }

    // Recebimento de candidato ICE do outro dispositivo
    if (message.data.candidate) {
      if (this.remoteDescriptionSet) {
        await this.pc.addIceCandidate(message.data.candidate);
      } else {
        // Enfileira se a descrição remota ainda não tiver sido definida
        this.pendingCandidates.push(message.data.candidate);
      }
    }
  }

  /**
   * Aplica todos os candidatos ICE acumulados na fila de espera.
   */
  async addPendingCandidates() {
    const candidates = this.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      await this.pc.addIceCandidate(candidate);
    }
  }

  /**
   * Configura os listeners de eventos do RTCDataChannel para troca de dados binários.
   */
  setupChannel(channel) {
    if (this.channel === channel && channel.readyState === "open") return;
    this.channel = channel;
    channel.binaryType = "arraybuffer"; // Garante recepção de chunks como buffers binários
    channel.onopen = () => {
      this.connected = true;
      this.clearConnectionTimeout();
      this.onOpen?.();
    };
    channel.onclose = () => this.close("disconnected");
    channel.onerror = () => this.close("failed");
    channel.onmessage = ({ data }) => this.onMessage?.(data);
  }

  startConnectionTimeout() {
    this.clearConnectionTimeout();
    this.connectionTimer = setTimeout(() => {
      if (!this.connected) this.reportConnectionFailure();
    }, 15000);
  }

  clearConnectionTimeout() {
    if (!this.connectionTimer) return;
    clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
  }

  reportConnectionFailure() {
    if (this.issueReported || this.connected) return;
    this.issueReported = true;
    this.onConnectionFailure?.();
    this.close("failed");
  }

  reportDisconnected() {
    if (this.issueReported) return;
    this.issueReported = true;
    this.onDisconnected?.();
    this.close("disconnected");
  }

  /**
   * Envia dados de sinalização para o outro par através do servidor WebSocket.
   */
  sendSignal(data) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "signal", data }));
  }

  /**
   * Envia dados (texto ou binário) diretamente pelo canal P2P WebRTC.
   */
  send(data) {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("O canal de dados ainda não está conectado.");
    }
    this.channel.send(data);
  }

  /**
   * Retorna a referência do RTCDataChannel para controle de fluxo de envio.
   */
  getDataChannel() {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("O canal de dados ainda não está conectado.");
    }
    return this.channel;
  }

  /**
   * Consulta as estatísticas da conexão para determinar se o tráfego é local (LAN) ou via internet.
   */
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

    // Se o tipo do candidato for 'host', a rota é direta na mesma rede local
    return candidateType === "host"
      ? "Local (P2P direto)"
      : "Via internet (P2P)";
  }

  /**
   * Encerra com segurança o RTCDataChannel e a RTCPeerConnection.
   */
  close(reason = "closed") {
    if (this.closed) return;
    this.closed = true;
    this.clearConnectionTimeout();
    if (this.channel && this.channel.readyState !== "closed") this.channel.close();
    if (this.pc.signalingState !== "closed") this.pc.close();
    this.onClose?.(reason);
  }
}
