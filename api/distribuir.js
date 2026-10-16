const {
  getClosersElegiveis,
  incrementarContador,
  salvarAjusteFila,
  contarReunioesAgendadasPorDia,
  semearReunioesDeHoje,
  carregarAgendaDoDia,
  reunioesSeChocam,
  registrarLog,
} = require("../lib/sheets");
const { escolherCloser, escolherCloserOutroDia, calcularEntradasTardias } = require("../lib/distribuicao");
const { norm } = require("../lib/normalizar");
const {
  buscarOwnerIdPorNome,
  moverEAtribuirDeal,
  buscarReuniaoRelevante,
  buscarDonoAtualDoDeal,
} = require("../lib/pipedrive");
const { DESTINO_POR_SUBAREA, DURACAO_PADRAO_REUNIAO_MIN } = require("../lib/config");

function horaParaMinutos(str) {
  const m = String(str || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/**
 * O closer já tem outra reunião que se choca com esta (mesmo dia, horários
 * sobrepostos)? A agenda vem do log_distribuicao; antes de barrar o closer,
 * confere no Pipedrive se aquela reunião continua no mesmo horário e com ele
 * (o SDR pode ter remarcado, ou o head remanejado) — log velho não bloqueia
 * ninguém à toa. Se o Pipedrive não responder, vale o log (lado conservador).
 */
async function closerTemChoque(closer, agenda, reuniao, dealId) {
  const inicio = horaParaMinutos(reuniao && reuniao.due_time);
  if (inicio === null) return false; // sem horário (dia todo): não há o que comparar
  const nova = { inicio, fim: inicio + (reuniao.duracao_min || DURACAO_PADRAO_REUNIAO_MIN) };

  const candidatas = (agenda[norm(closer.nome)] || []).filter(
    (e) => e.dealId !== String(dealId) && reunioesSeChocam(e, nova)
  );

  for (const e of candidatas) {
    try {
      const atual = await buscarReuniaoRelevante(e.dealId);
      const { ownerNome } = await buscarDonoAtualDoDeal(e.dealId);
      const iniAtual = atual ? horaParaMinutos(atual.due_time) : null;
      const aindaChoca =
        atual &&
        atual.due_date === reuniao.due_date &&
        iniAtual !== null &&
        reunioesSeChocam(
          { inicio: iniAtual, fim: iniAtual + (atual.duracao_min || DURACAO_PADRAO_REUNIAO_MIN) },
          nova
        ) &&
        norm(ownerNome) === norm(closer.nome);
      if (aindaChoca) return true;
    } catch (err) {
      console.warn(`Aviso: não foi possível confirmar a reunião do deal ${e.dealId} no Pipedrive (${err.message}). Valendo o log.`);
      return true;
    }
  }
  return false;
}

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
    // Reuniões marcadas em dias anteriores pra HOJE entram em REUNIOES_ATUAIS_HOJE
    // antes de decidir quem está abaixo da meta (idempotente: soma cada deal 1x).
    try {
      await semearReunioesDeHoje();
    } catch (errSemear) {
      console.warn(`Aviso: não foi possível somar as reuniões de dias anteriores. Erro: ${errSemear.message}`);
    }
    const closers = await getClosersElegiveis(momentoEscala);
    if (closers.length === 0) {
      return res.status(422).json({
        error:
          "Nenhum closer elegível encontrado na planilha (Elite/MGM, ativo, mês/ano atual, dentro da escala pro horário da reunião).",
      });
    }

    let escolhido;
    let escolherDaFila;
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
      escolherDaFila = escolherCloserOutroDia;
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
      escolherDaFila = escolherCloser;
    }

    // Choque de horário: o closer da vez que já tem reunião nesse dia/horário
    // (hoje ou outro dia) é pulado e a vez passa pro próximo da fila. Como ele
    // não recebeu, o contador dele não sobe: continua primeiro pra próxima.
    let agenda = {};
    if (reuniao && reuniao.due_date && reuniao.due_time) {
      try {
        agenda = await carregarAgendaDoDia(reuniao.due_date);
      } catch (errAgenda) {
        console.warn(
          `Aviso: não foi possível ler a agenda de ${reuniao.due_date} no log. Sem checagem de choque de horário. Erro: ${errAgenda.message}`
        );
      }
    }

    let candidatos = [...closers];
    const pulados = [];
    while (candidatos.length > 0) {
      const da_vez = escolherDaFila(candidatos);
      if (!(await closerTemChoque(da_vez, agenda, reuniao, dealId))) {
        escolhido = da_vez;
        break;
      }
      pulados.push(da_vez.nome);
      candidatos = candidatos.filter((c) => c !== da_vez);
    }

    let choqueForcado = false;
    if (!escolhido) {
      // Todo mundo do pool está ocupado nesse horário: melhor entregar (o head
      // remaneja) do que deixar o lead parado em DISTRIBUIÇÃO.
      choqueForcado = true;
      escolhido = escolherDaFila(closers);
      console.warn(
        `Deal ${dealId}: todos os closers elegíveis já têm reunião em ${reuniao.due_date} ${reuniao.due_time}. Atribuído a ${escolhido.nome} mesmo assim.`
      );
    } else if (pulados.length > 0) {
      console.log(`Deal ${dealId}: pulou ${pulados.join(", ")} (já têm reunião no mesmo horário). Atribuído a ${escolhido.nome}.`);
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
      await registrarLog(escolhido, dealId, reunioesAposDistribuicao, contaHoje ? null : dueDateEncontrada, reuniao);
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
      pulados_por_choque_de_horario: pulados,
      choque_de_horario_forcado: choqueForcado,
    });
  } catch (err) {
    console.error("Erro ao processar distribuição:", err);
    return res.status(500).json({ error: err.message });
  }
};
