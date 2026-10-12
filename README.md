# AgendaZap — agendador de mensagens para grupos (WhatsApp Cloud API)

## Rodar
1. `docker compose up -d`  (Postgres + Redis)
2. `cd api && cp .env.example .env && npm i && npm run dev`
3. `cd web && npm i && npm run dev`  → http://localhost:5173

Sem `WA_TOKEN`/`WA_PHONE_ID` o sistema roda em **modo demonstração** (nada é enviado).
Para envio real: crie o app na Meta, número Business, preencha o `.env` e cadastre cada grupo com o ID retornado pela Groups API.
Confirme na documentação da Meta se sua conta tem acesso à Groups API.

## Notas
- Horários: o navegador envia em UTC (ISO); a tela mostra no seu fuso.
- Duplicidade: o worker só envia se status = pending (UPDATE atômico) e não há retry automático.
- Mídia: até 16 MB, enviada à Meta no momento do disparo.
- Próximos passos: recorrência diária, testes (Vitest/Supertest), recuperação de senha.

## Conexão direta com o seu WhatsApp (SEND_MODE=wa)
Use `SEND_MODE=wa` no `.env`. Ao abrir o site, escaneie o QR em WhatsApp > Aparelhos conectados.
Seus grupos são importados sozinhos; escolha o grupo na lista ao agendar.
Uso não oficial: pode violar os termos do WhatsApp e levar ao bloqueio do número. Mantenha o volume baixo, com intervalos entre envios.

## Publicar (GitHub + Vercel + API em Railway/Render)
1. Suba o projeto num repositório PRIVADO (o .gitignore já protege .env, wa_auth e uploads).
2. API (Railway/Render): raiz `api`, build `npm i`, start `npm start`. Adicione Postgres e Redis,
   configure as variáveis do `.env.example` e monte volume persistente em `wa_auth` e `uploads`.
3. Site (Vercel): raiz `web`, preset Vite. Edite `web/vercel.json` com a URL pública da API.
4. Crie sua conta, depois defina `ALLOW_REGISTER=false` na API. Escaneie o QR e teste com um grupo só seu.
