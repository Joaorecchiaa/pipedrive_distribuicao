const {
  getClosersElegiveis,
  incrementarContador,
  salvarAjusteFila,
  contarReunioesAgendadasPorDia,
  registrarLog,
} = require("../lib/sheets");
const { escolherCloser, escolherCloserOutroDia, calcularEntradasTardias } = require("../lib/distribuicao");
const { norm } = require("../lib/normalizar");
const { buscarOwnerIdPorNome, moverEAtribuirDeal, buscarReuniaoRelevante } = require("../lib/pipedrive");
const { DESTINO_POR_SUBAREA } = require("../lib/config");

// Extrai o ID do deal do payload do webhook do Pipedrive.
// Cobre os formatos mais comuns (v1 legado e v2).
function extrairDealId(body) {
  const bruto =
    body?.deal_id ??
    body?.data?.id ??
    body?.current?.id ??
    body?.object?.id ??
    body?.meta?.id ??
    null;

  if (bruto === null || bruto === undefined || bruto === "") return null;
  const numero = Number(bruto);
  return Number.isNaN(numero) ? null : numero;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido, use POST." });
  }

  // Proteção simples do endpoint via query param — configure o mesmo valor
  // na URL do webhook cadastrada na automação do Pipedrive: ?secret=XXXX
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  if (WEBHOOK_SECRET && req.query?.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  try {
    const dealId = extrairDealId(req.body);
    if (!dealId) {
      return res.status(400).json({ error: "Não foi possível identificar o deal_id no payload." });
    }

    // Busca a reunião (due_date + due_time) ANTES de escolher o closer.
    //
    // A escala é conferida contra o dia/horário da própria reunião (ver
    // momentoEscala abaixo). Deal sem reunião marcada: escala de agora.
    let reuniao = null;
    try {
      reuniao = await buscarReuniaoRelevante(dealId);
    } catch (errReuniao) {
      console.warn(
        `Aviso: não foi possível buscar a reunião do deal ${dealId}. Usando a escala de agora como fallback. Erro: ${errReuniao.message}`
      );
    }

    const hojeStrEscala = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); // "AAAA-MM-DD"
    const reuniaoEhDeOutroDia = !!(reuniao && reuniao.due_date && reuniao.due_date !== hojeStrEscala);

    // A escala é sempre conferida no dia/horário DA REUNIÃO (hoje ou outro dia):
    // quem entra às 11h pode receber, às 09h, uma reunião marcada pras 12h.
    // Exceções: reunião de hoje sem horário (dia todo) ou com horário que já
    // passou → vale a escala de agora (quem vai atender é quem está de plantão).
    let momentoEscala = null;
    if (reuniao && reuniao.due_date) {
      if (reuniaoEhDeOutroDia) {
        momentoEscala = { data: reuniao.due_date, hora: reuniao.due_time };
      } else if (reuniao.due_time) {
        const horaAgora = new Date().toLocaleTimeString("en-GB", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        });
        momentoEscala = { data: reuniao.due_date, hora: reuniao.due_time > horaAgora ? reuniao.due_time : horaAgora };
      }
    }
    const closers = await getClosersElegiveis(momentoEscala);
    if (closers.length === 0) {
      return res.status(422).json({
        error:
          "Nenhum closer elegível encontrado na planilha (Elite/MGM, ativo, mês/ano atual, dentro da escala pro horário da reunião).",
      });
    }

    let escolhido;
    if (reuniaoEhDeOutroDia) {
      // Fila própria das reuniões de outro dia: rodízio pelo que já foi
      // distribuído pra AQUELA data (os contadores de hoje não mudam com
      // reunião de amanhã e dariam sempre o mesmo closer).
      let contagens = {};
      try {
        contagens = await contarReunioesAgendadasPorDia(reuniao.due_date);
      } catch (errContagem) {
        console.warn(
          `Aviso: não foi possível contar as reuniões já distribuídas pra ${reuniao.due_date}. Erro: ${errContagem.message}`
        );
      }
      for (const c of closers) c.agendadasNoDia = contagens[norm(c.nome)] || 0;
      escolhido = escolherCloserOutroDia(closers);
    } else {
      // Quem chegou mais tarde não recupera o atraso: entra na posição atual
      // da fila e espera a vez dele. O ajuste é gravado na planilha
      // (AJUSTE_FILA) porque precisa valer também nas próximas distribuições.
      for (const { closer, novoAjuste } of calcularEntradasTardias(closers, closers.todos)) {
        closer.ajusteFila = novoAjuste;
        try {
          await salvarAjusteFila(closer, novoAjuste);
        } catch (errAjuste) {
          console.warn(`Aviso: não foi possível gravar AJUSTE_FILA de ${closer.nome}. Erro: ${errAjuste.message}`);
        }
      }
      escolhido = escolherCloser(closers);
    }
    const destino = DESTINO_POR_SUBAREA[escolhido.subareaNorm];
    if (!destino) {
      return res.status(500).json({ error: `Sem destino configurado para subarea '${escolhido.subareaNorm}'.` });
    }

    const ownerId = await buscarOwnerIdPorNome(escolhido.nome);
    await moverEAtribuirDeal(dealId, ownerId, destino.pipeline_id, destino.stage_id);

    // Só conta pra hoje se a reunião estiver de fato agendada pra hoje
    // (due_date da atividade). Se for pra outro dia, não incrementa nada —
    // não conta em dia nenhum, só não pode contar hoje (e por isso o closer
    // não perde a vez: o contador dele não sobe).
    let contaHoje = true;
    const dueDateEncontrada = reuniao ? reuniao.due_date : null;
    if (dueDateEncontrada) {
      contaHoje = dueDateEncontrada === hojeStrEscala;
    }

    let reunioesAposDistribuicao = escolhido.reunioesHoje;
    if (contaHoje) {
      reunioesAposDistribuicao = escolhido.reunioesHoje + 1;
      try {
        reunioesAposDistribuicao = await incrementarContador(escolhido);
      } catch (errContador) {
        console.warn(
          `Aviso: não foi possível incrementar o contador. Deal foi distribuído normalmente. Erro: ${errContador.message}`
        );
      }
    } else {
      // No log, REUNIOES_DO_DIA mostra quantas já estão marcadas pra aquela data (incluindo esta).
      reunioesAposDistribuicao = (escolhido.agendadasNoDia || 0) + 1;
      console.log(`Deal ${dealId}: reunião agendada pra outro dia, não incrementado o contador de hoje.`);
    }

    // Log em log_distribuicao — não deixa o fluxo quebrar se a aba ainda não existir.
    try {
      await registrarLog(escolhido, dealId, reunioesAposDistribuicao, contaHoje ? null : dueDateEncontrada);
    } catch (errLog) {
      console.warn(`Aviso: não foi possível registrar no log_distribuicao. Erro: ${errLog.message}`);
    }

    console.log(`Deal ${dealId} atribuído a ${escolhido.nome} (${escolhido.subareaNorm})`);

    return res.status(200).json({
      ok: true,
      deal_id: dealId,
      closer: escolhido.nome,
      subarea: escolhido.subareaNorm,
      destino,
      contou_para_hoje: contaHoje,
    });
  } catch (err) {
    console.error("Erro ao processar distribuição:", err);
    return res.status(500).json({ error: err.message });
  }
};
