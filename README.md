# PassaAí — MVP

Transferência direta de arquivos entre dois dispositivos, sem login e sem
servidor intermediário para os arquivos. O servidor faz apenas a interface,
as salas e a sinalização WebSocket.

## Rodar localmente

Requer Node.js 18 ou superior.

```bash
npm install
npm start
```

Abra `http://localhost:3000` no computador. Clique em **Criar sala** e
compartilhe o código ou o QR Code.

## Conectar o celular

1. Conecte o celular e o computador à mesma rede Wi-Fi.
2. Abra no celular a URL `LAN` exibida no terminal, por exemplo
   `http://192.168.0.10:3000`, ou escaneie o QR Code.
3. Aguarde o status **Conectado via P2P** e envie arquivos em qualquer direção.
   É possível selecionar ou arrastar vários arquivos; eles entram em uma fila e
   são transferidos um por vez. No celular, toque em **Selecionar arquivos** e
   marque os arquivos desejados no seletor do sistema.

O navegador usa `ws://` em HTTP e `wss://` automaticamente quando a página está
em HTTPS.

## Deploy no Render

1. Crie um **Web Service** conectado ao repositório.
2. Selecione o ambiente **Node**.
3. Use `npm install` na instalação (ou o padrão do Render).
4. Configure o Start Command como:

```text
npm start
```

O servidor usa automaticamente a porta fornecida pela variável `PORT` e escuta
em `0.0.0.0`. No Render, a página deve ser acessada por HTTPS para que o
WebSocket use `wss://`.

## Riscos conhecidos

- O MVP usa apenas STUN; algumas redes restritas podem exigir TURN e impedir o
  WebRTC direto.
- A sala existe somente enquanto houver conexão com o servidor. Ao perder a
  conexão, use **Reconectar** ou **Nova sala**.
- A transferência não pode ser retomada após queda e a sessão não é persistida.
- Vários arquivos podem ser enfileirados, mas apenas um envio por dispositivo
  ocorre por vez; a fila não é retomada automaticamente após uma queda.
- A integridade é verificada pelo tamanho, não por hash criptográfico.
- O tráfego WebRTC é protegido pelo transporte WebRTC, mas não há autenticação,
  expiração de código ou controle de acesso adicional.
