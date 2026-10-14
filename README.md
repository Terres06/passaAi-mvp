## PassaAí — MVP

Transferência direta de arquivos entre dois dispositivos usando WebRTC. O
servidor entrega a interface, cria salas de quatro dígitos e faz apenas a
sinalização; o arquivo nunca passa pelo servidor.

### Executar

Requer Node.js 18 ou superior.

```bash
npm install
npm start
```

Abra `http://localhost:3000` no primeiro dispositivo, crie uma sala e use o
código ou o QR Code no segundo dispositivo. Para testar em outro aparelho na
mesma rede, use a URL da LAN exibida no terminal.

### Estrutura

- `server.js`: Express, endpoint de QR Code e sinalização WebSocket.
- `public/app.js`: interface, salas e ciclo de sinalização.
- `public/rtc.js`: conexão RTCPeerConnection.
- `public/transfer.js`: protocolo de arquivos, chunks e backpressure.