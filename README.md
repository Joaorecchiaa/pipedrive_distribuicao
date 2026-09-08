# pipedrive-distribuicao (closer)

Distribui automaticamente deals que saem do estágio **SNIPER / AGENDADOS** (pipeline 88, stage 815)
para um closer do **ELITE** (pipeline 87, stage 803) ou **OLYMPUS** (pipeline 46, stage 354 — label "MGM" na planilha),
respeitando um teto diário de reuniões por nível de closer.

## Regra de distribuição (fase de teste)

| Cargo | Teto/dia |
|---|---|
| Closer 1 | 3 |
| Closer 2 | 4 |
| Closer 3 | 5 |
| Closer 4 | 6 |
| Closer 5 | 7 |

- **Fase 1** — enquanto pelo menos um closer estiver abaixo do próprio teto: recebe quem tiver a menor razão `reuniões_hoje / teto` (quem está "mais devendo").
- **Fase 2** — quando todos já bateram o teto: sorteio aleatório puro entre todos os closers elegíveis.

Ajuste os tetos em `lib/config.js` (`LIMITE_DIARIO_POR_NIVEL`) quando a regra definitiva for fechada.

## Setup

1. `npm install`
2. Copie `.env.example` para `.env` e preencha (pode reaproveitar `PIPEDRIVE_API_TOKEN` e `GOOGLE_SERVICE_ACCOUNT_JSON` do projeto `pipedrive_escala`)
3. Garanta que a Service Account tem acesso de edição na planilha `config_dashs`
4. Crie a coluna **"Reuniões no Dia"** na aba `colaboradores`, zerada
5. `vercel --prod` para deploy

## Configuração no Pipedrive

**Configurações > Automações > Nova automação**
- Gatilho: negócio movido para estágio → Funil = **SNIPER**, Estágio = **AGENDADOS**
- Ação: Enviar webhook (POST) →
  `https://SEU-PROJETO.vercel.app/api/distribuir?secret=WEBHOOK_SECRET`

## Variáveis de ambiente (configurar no painel do Vercel)

| Variável | Descrição |
|---|---|
| `PIPEDRIVE_API_TOKEN` | Token da API (mesmo do pipedrive_escala) |
| `PIPEDRIVE_DOMAIN` | ex: `seudominio.pipedrive.com` |
| `GOOGLE_SHEET_ID` | ID da planilha config_dashs |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON da Service Account (mesmo do pipedrive_escala) |
| `WEBHOOK_SECRET` | string secreta usada na URL do webhook |
| `CRON_SECRET` | protege o endpoint de reset diário (usado automaticamente pelo Vercel Cron) |

## Endpoints

- `POST /api/distribuir` — recebe o webhook do Pipedrive, escolhe o closer e move o deal
- `GET /api/reset-diario` — roda via Vercel Cron todo dia às 00:01 (BRT), zera a coluna "Reuniões no Dia"

## Testando localmente

```bash
vercel dev
curl -X POST "http://localhost:3000/api/distribuir?secret=SEU_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"data": {"id": 12345}}'
```

## Notas

- O matching do closer com o usuário do Pipedrive é feito por **nome normalizado** (minúsculas, sem acento) — não existe coluna de e-mail na aba `colaboradores`. Se dois colaboradores tiverem nomes muito parecidos, revise manualmente.
- Cargos sem número (ex: "Closer Legendário") ficam automaticamente fora do pool — só entram cargos no formato "Closer N" com N mapeado em `LIMITE_DIARIO_POR_NIVEL`.
- Se `getClosersElegiveis()` retornar vazio (ninguém ativo em Elite/MGM no mês/ano atual), o endpoint responde 422 e o deal **não é movido** — fica parado no estágio de origem até alguém investigar.
