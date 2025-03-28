# Bot Telegram para Verificação de Domínios

Este bot do Telegram permite verificar informações detalhadas sobre domínios, incluindo IPs, CDNs e status de conexão.

## Funcionalidades

- Resolve domínios para seus respectivos IPs
- Lista todos os IPs associados ao domínio
- Verifica o status de conexão HTTP/HTTPS
- Verifica se os IPs pertencem à rede Cloudflare
- Detecta outras CDNs populares:
  - Akamai
  - Fastly
  - Amazon CloudFront
  - Google Cloud CDN
  - Microsoft Azure CDN
- Interface amigável com emojis
- Suporte a códigos de status HTTP comuns:
  - 2xx (Sucesso)
  - 3xx (Redirecionamento)
  - 4xx (Erro do Cliente)
  - 5xx (Erro do Servidor)

## Comandos

- `/start` - Inicia o bot e mostra a mensagem de boas-vindas
- `/check [domínio]` - Analisa um domínio e mostra informações detalhadas
- `/help` - Mostra a lista de comandos disponíveis

## Configuração

1. Instale as dependências:
```bash
npm install
```

2. Configure o arquivo `.env`:
- Renomeie o arquivo `.env.example` para `.env`
- Adicione seu token do bot do Telegram:
```
TELEGRAM_BOT_TOKEN=seu_token_aqui
```

Para obter um token do bot:
1. Fale com o [@BotFather](https://t.me/botfather) no Telegram
2. Use o comando `/newbot`
3. Siga as instruções para criar seu bot
4. Copie o token fornecido

## Como usar

1. Inicie o bot:
```bash
npm start
```

2. No Telegram:
- Inicie uma conversa com seu bot
- Use o comando `/start` para ver as instruções
- Use `/check [domínio]` para analisar um domínio

## Exemplo de uso

Para verificar um domínio:
```
/check google.com
```
O bot irá mostrar:
- Protocolo de conexão (HTTP/HTTPS)
- Status da conexão (200, 301, 404, etc.)
- Lista de todos os IPs do domínio
- CDNs detectadas para cada IP 
