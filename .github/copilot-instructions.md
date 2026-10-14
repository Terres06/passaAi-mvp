# PassaAí — MVP (contexto do projeto)

## O que é
PassaAí ("Mandou, passou.") é um site de transferência direta de arquivos entre
dispositivos (PC↔celular, celular↔celular), sem login, sem instalação e sem nuvem
intermediária. Este repositório é um MVP acadêmico (PUCPR, Projeto de Negócio Inovador)
cujo único objetivo é DEMONSTRAR um arquivo sendo transferido entre dois dispositivos.

## Escopo do MVP
DENTRO: criar sala, código de 4 dígitos + QR code, entrar na sala, conexão WebRTC,
envio de arquivo bidirecional, progresso nos dois lados, download no receptor,
checagem de integridade por tamanho.
FORA: autenticação, criptografia extra, SHA-256, pastas, TURN, banco de dados, testes
automatizados, qualquer framework de frontend.

## Stack
- Node.js (>=18), Express, ws. Sem TypeScript, sem bundler.
- Frontend: HTML + CSS + JavaScript puro com ES modules (<script type="module">).
- Única dependência de frontend permitida: gerar QR via pacote npm `qrcode` no servidor
  (endpoint GET /api/qr?text=...) retornando PNG/dataURL.

## Arquitetura
- Servidor: serve /public, expõe GET /api/info ({ lanOrigin }) com o IP da LAN,
  GET /api/qr, e um WebSocket em /ws apenas para SINALIZAÇÃO. O servidor NUNCA recebe
  o arquivo.
- Salas: Map<code, Set<ws>> com no máximo 2 peers. Código numérico de 4 dígitos, único.
- Mensagens WS (JSON):
  - cliente→servidor: {type:"create"} | {type:"join", room} | {type:"signal", data}
  - servidor→cliente: {type:"created", room} | {type:"joined", room}
    | {type:"peer-joined"} | {type:"signal", data} | {type:"peer-left"}
    | {type:"error", reason:"room-not-found"|"room-full"}
  - "signal" apenas repassa ao outro peer da sala (data = {sdp} ou {candidate}).
- Quem criou a sala é o "caller": ao receber "peer-joined", cria o RTCDataChannel
  ("files"), gera a offer e a envia. Quem entrou é o "callee": responde com answer.
- ICE: iceServers = [{urls:"stun:stun.l.google.com:19302"}]. Usar trickle ICE.
- URL do WebSocket derivada de location.protocol (ws:// ou wss://).

## Protocolo no DataChannel
- dc.binaryType = "arraybuffer".
- Antes de cada arquivo: mensagem texto JSON {t:"meta", id, name, size, mime}.
- Depois: chunks binários (ArrayBuffer) de 16384 bytes, lidos com file.slice().arrayBuffer().
- Ao final: {t:"end", id}.
- Receptor: acumula chunks, ao receber "end" compara bytes recebidos com meta.size
  (ok → cria Blob e link de download; divergente → mostra erro de integridade).
- Backpressure obrigatório: dc.bufferedAmountLowThreshold = 1MB; se
  dc.bufferedAmount > 1MB, aguardar o evento "bufferedamountlow" antes de enviar mais.
- Os dois lados podem enviar e receber.

## Regras de código
- Código simples, comentado em português, funções pequenas, sem over-engineering.
- Tratar erros de usuário com mensagens claras na UI (sala inexistente, sala cheia,
  conexão perdida).
- O QR deve codificar `${lanOrigin}/?room=CODIGO`, onde lanOrigin vem de /api/info quando
  location.hostname for localhost/127.0.0.1; caso contrário usar location.origin.
- Se a URL tiver ?room=XXXX, entrar automaticamente nessa sala.
- Servidor escuta em 0.0.0.0, porta process.env.PORT || 3000, e imprime no console a URL da LAN.

## Identidade visual
- Cor primária azul #0284C7 (logo), texto/título azul-marinho #0B1730, cinza #475569,
  fundo claro #F8FAFC, sucesso #10B981, erro #EF4444.
- Fontes: Merriweather (títulos) e DM Sans (corpo), via Google Fonts.
- Logo em /logo.png. Slogan: "Mandou, passou."
- Mobile-first: botões grandes, layout de coluna única, funcional em tela de 360px.
- Todos os textos da interface em português do Brasil.