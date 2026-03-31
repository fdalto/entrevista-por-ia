const N8N_WEBHOOK_URL = "https://n8ndovitordalto.duckdns.org/webhook/entrevista-IA";
const MODO_SIMULADO = false;
const DEBUG_LOGS = true;

/*
  Configuração de autenticação para webhook n8n:
  - "none": sem autenticação
  - "bearer": Authorization: Bearer <token>
  - "basic": Authorization: Basic <base64(user:pass)>
  - "header": cabeçalho customizado
*/
const N8N_AUTH_MODE = "basic";
const N8N_BEARER_TOKEN = "COLOCAR_BEARER_TOKEN_AQUI";
const N8N_BASIC_USER = "entrevista-ia";
const N8N_BASIC_PASS = "";
const N8N_CUSTOM_HEADER_NAME = "X-Webhook-Token";
const N8N_CUSTOM_HEADER_VALUE = "COLOCAR_VALOR_CABECALHO_AQUI";

const CHUNK_DURATION_MS = 45_000;
const CHUNK_SEND_MAX_TENTATIVAS = 3;
const CHUNK_SEND_RETRY_MS = 1500;
const CHUNK_RESPOSTA_VAZIA_RETRY_MAX = 1;
const CHUNK_RESPOSTA_VAZIA_RETRY_MS = 1200;
const IDENTIFICACAO_DURACAO_MAX_MS = 6_000;
const LOG_LIMITE = 120;
const AUDIO_BITS_PER_SECOND = 16_000;

const estado = {
  interviewerBlob: null,
  interviewerMimeType: "",
  interviewerRecorder: null,
  interviewerStream: null,
  interviewerChunks: [],
  interviewerStopTimeout: null,

  interviewRecorder: null,
  interviewStream: null,
  interviewId: "",
  interviewStartMs: 0,
  interviewElapsedMs: 0,
  ultimoChunkFimMs: 0,
  isInterviewRunning: false,
  encerramentoSolicitado: false,

  chunkIndex: 0,
  chunksEnviados: 0,
  respostasRecebidas: 0,
  transcricaoAcumulada: "",

  filaChunks: [],
  filaProcessando: false,
  timerInterval: null
};

const refs = {};

document.addEventListener("DOMContentLoaded", () => {
  logEvento("Página carregada.");
  carregarReferencias();
  bindEventos();
  validarSuporteNavegador();
  atualizarContadores();
});

function carregarReferencias() {
  refs.btnIdentificar = document.getElementById("btnIdentificar");
  refs.btnIniciar = document.getElementById("btnIniciar");
  refs.btnFinalizar = document.getElementById("btnFinalizar");
  refs.btnResetar = document.getElementById("btnResetar");
  refs.btnCopiar = document.getElementById("btnCopiar");
  refs.interviewerStatus = document.getElementById("interviewerStatus");
  refs.interviewerStateBadge = document.getElementById("interviewerStateBadge");
  refs.interviewStatus = document.getElementById("interviewStatus");
  refs.tempoEntrevista = document.getElementById("tempoEntrevista");
  refs.chunksEnviados = document.getElementById("chunksEnviados");
  refs.respostasRecebidas = document.getElementById("respostasRecebidas");
  refs.recordingDot = document.getElementById("recordingDot");
  refs.recordingLabel = document.getElementById("recordingLabel");
  refs.logList = document.getElementById("logList");
  refs.transcriptionSection = document.getElementById("transcriptionSection");
  refs.transcriptionText = document.getElementById("transcriptionText");
  refs.copyFeedback = document.getElementById("copyFeedback");
}

function bindEventos() {
  refs.btnIdentificar.addEventListener("click", gravarAudioEntrevistador);
  refs.btnIniciar.addEventListener("click", iniciarEntrevista);
  refs.btnFinalizar.addEventListener("click", finalizarEntrevista);
  refs.btnResetar.addEventListener("click", resetarEntrevista);
  refs.btnCopiar.addEventListener("click", copiarTranscricao);
}

function validarSuporteNavegador() {
  const suporteOk =
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof window.fetch === "function" &&
    typeof window.FormData !== "undefined" &&
    typeof window.Blob !== "undefined";

  if (suporteOk) {
    logEvento("Navegador compatível com recursos de áudio.");
    setStatusInterviewer("Pronto para gravar a identificação.", "status-ok");
    setStatusEntrevista("Aguardando início da entrevista.", "status-warning");
    definirEstadoIdentificacao("ready");
    return;
  }

  const msg = "Este navegador não suporta todos os recursos de áudio necessários.";
  logEvento("Navegador incompatível com recursos necessários.", { msg }, "warn");
  setStatusInterviewer(msg, "status-error");
  setStatusEntrevista(msg, "status-error");
  refs.btnIdentificar.disabled = true;
  refs.btnIniciar.disabled = true;
  refs.btnFinalizar.disabled = true;
  refs.btnResetar.disabled = true;
}

async function gravarAudioEntrevistador() {
  if (estado.interviewerRecorder && estado.interviewerRecorder.state === "recording") {
    logEvento("Parada manual da gravação de identificação.");
    estado.interviewerRecorder.stop();
    return;
  }

  try {
    logEvento("Iniciando fluxo de identificação do entrevistador.");
    setStatusInterviewer("Solicitando acesso ao microfone...", "status-warning");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    estado.interviewerStream = stream;
    estado.interviewerChunks = [];

    const recorder = criarMediaRecorder(stream);
    estado.interviewerRecorder = recorder;

    recorder.onstart = () => {
      logEvento("Gravação de identificação iniciada.");
      definirEstadoIdentificacao("recording");
      refs.btnIdentificar.textContent = "Parar identificação";
      refs.btnIniciar.disabled = true;
      setStatusInterviewer("Gravando identificação (até 6s)...", "status-warning");
      registrarLog("Gravação da identificação iniciada.", "info");

      estado.interviewerStopTimeout = window.setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, IDENTIFICACAO_DURACAO_MAX_MS);
    };

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        logEvento("Chunk da identificação capturado.", { size: event.data.size });
        estado.interviewerChunks.push(event.data);
      }
    };

    recorder.onerror = (event) => {
      logEvento("Erro no MediaRecorder da identificação.", { event }, "error");
      setStatusInterviewer("Falha na gravação de identificação.", "status-error");
      definirEstadoIdentificacao("ready");
      limparRecursosIdentificacao();
    };

    recorder.onstop = () => {
      logEvento("Gravação de identificação finalizada.");
      window.clearTimeout(estado.interviewerStopTimeout);
      estado.interviewerStopTimeout = null;
      refs.btnIdentificar.textContent = "Identificar entrevistador";

      if (!estado.interviewerChunks.length) {
        logEvento("Identificação finalizada sem áudio válido.", null, "warn");
        setStatusInterviewer("Nenhum áudio foi capturado. Tente novamente.", "status-error");
        definirEstadoIdentificacao("ready");
        refs.btnIniciar.disabled = false;
        limparRecursosIdentificacao();
        return;
      }

      const tipo = detectarMimeTypeBlob(estado.interviewerChunks[0], recorder.mimeType);
      estado.interviewerMimeType = tipo;
      estado.interviewerBlob = new Blob(estado.interviewerChunks, { type: tipo });
      logEvento("Identificação salva em memória.", {
        mimeType: tipo,
        size: estado.interviewerBlob.size
      });

      setStatusInterviewer("Identificação do entrevistador registrada com sucesso.", "status-ok");
      setStatusEntrevista("Identificação pronta. Você já pode iniciar.", "status-ok");
      definirEstadoIdentificacao("done");
      refs.btnIniciar.disabled = false;
      registrarLog("Identificação do entrevistador salva.", "success");

      limparRecursosIdentificacao();
    };

    recorder.start();
  } catch (error) {
    logEvento("Falha ao iniciar identificação.", { erro: mensagemErro(error) }, "error");
    refs.btnIdentificar.textContent = "Identificar entrevistador";
    definirEstadoIdentificacao("ready");
    setStatusInterviewer("Não foi possível acessar o microfone.", "status-error");
    registrarLog(`Erro de microfone na identificação: ${mensagemErro(error)}`, "error");
    limparRecursosIdentificacao();
  }
}

async function iniciarEntrevista() {
  if (!estado.interviewerBlob) {
    logEvento("Tentativa de iniciar entrevista sem identificação.", null, "warn");
    setStatusEntrevista(
      "Grave primeiro a identificação do entrevistador para começar a entrevista.",
      "status-warning"
    );
    return;
  }

  if (estado.isInterviewRunning) {
    logEvento("Tentativa de iniciar entrevista enquanto já está em execução.", null, "warn");
    return;
  }

  if (!MODO_SIMULADO && (!N8N_WEBHOOK_URL || N8N_WEBHOOK_URL.includes("COLOCAR_URL_AQUI"))) {
    logEvento("Webhook não configurado para modo real.", { N8N_WEBHOOK_URL }, "warn");
    setStatusEntrevista(
      "Configure a constante N8N_WEBHOOK_URL no script.js antes de enviar chunks reais.",
      "status-warning"
    );
    registrarLog("Webhook não configurado. Ative MODO_SIMULADO ou informe a URL.", "error");
    return;
  }

  const validacaoAuth = validarConfiguracaoAuth();
  if (!MODO_SIMULADO && !validacaoAuth.ok) {
    logEvento("Configuração de autenticação inválida.", { motivo: validacaoAuth.motivo }, "warn");
    setStatusEntrevista(validacaoAuth.motivo, "status-warning");
    return;
  }

  try {
    logEvento("Iniciando entrevista.");
    setStatusEntrevista("Solicitando microfone para iniciar entrevista...", "status-warning");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    estado.interviewStream = stream;

    const recorder = criarMediaRecorder(stream);
    estado.interviewRecorder = recorder;

    estado.interviewId = criarIdEntrevista();
    estado.interviewStartMs = Date.now();
    estado.interviewElapsedMs = 0;
    estado.ultimoChunkFimMs = estado.interviewStartMs;
    estado.chunkIndex = 0;
    estado.chunksEnviados = 0;
    estado.respostasRecebidas = 0;
    estado.transcricaoAcumulada = "";
    estado.filaChunks = [];
    estado.encerramentoSolicitado = false;
    refs.transcriptionText.textContent = "";
    refs.btnCopiar.disabled = true;
    refs.copyFeedback.textContent = "";
    atualizarContadores();

    recorder.onstart = () => {
      logEvento("Entrevista começou a gravar.", { interviewId: estado.interviewId });
      estado.isInterviewRunning = true;
      alternarUiDuranteEntrevista(true);
      refs.transcriptionSection.classList.remove("hidden");
      if (!estado.transcricaoAcumulada.trim()) {
        refs.transcriptionText.textContent = "Aguardando retorno da transcrição em tempo real...";
      }
      setStatusEntrevista("Entrevista em andamento.", "status-ok");
      registrarLog(`Entrevista iniciada (ID ${estado.interviewId}).`, "info");
      iniciarCronometro();
    };

    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) {
        logEvento("Chunk descartado por tamanho zero.", null, "warn");
        return;
      }

      estado.chunkIndex += 1;
      const chunkEndMs = Date.now();
      const chunkStartMs = estado.ultimoChunkFimMs;
      estado.ultimoChunkFimMs = chunkEndMs;

      estado.filaChunks.push({
        blobOriginal: event.data,
        chunkIndex: estado.chunkIndex,
        chunkStartMs,
        chunkEndMs,
        tentativas: 0
      });
      logEvento("Chunk da entrevista enfileirado.", {
        chunkIndex: estado.chunkIndex,
        size: event.data.size,
        chunkStartMs,
        chunkEndMs
      });

      registrarLog(`Chunk ${estado.chunkIndex} capturado (${formatarTempo(chunkEndMs - chunkStartMs)}).`, "info");
      processarFilaChunks();
    };

    recorder.onerror = (event) => {
      logEvento("Erro no MediaRecorder durante entrevista.", { event }, "error");
      registrarLog("Falha no MediaRecorder durante entrevista.", "error");
      setStatusEntrevista("Falha na gravação da entrevista.", "status-error");
    };

    recorder.onstop = () => {
      logEvento("Captação da entrevista parada.");
      estado.isInterviewRunning = false;
      finalizarCronometro();
      limparRecursosEntrevista();
      registrarLog("Captação de áudio finalizada.", "info");
      setStatusEntrevista("Entrevista finalizada. Processando últimos chunks...", "status-warning");

      if (!estado.encerramentoSolicitado) {
        estado.encerramentoSolicitado = true;
      }

      if (!estado.filaProcessando && estado.filaChunks.length === 0) {
        concluirEncerramentoEntrevista();
      }
    };

    recorder.start(CHUNK_DURATION_MS);
  } catch (error) {
    logEvento("Erro ao iniciar entrevista.", { erro: mensagemErro(error) }, "error");
    setStatusEntrevista("Não foi possível iniciar a entrevista. Verifique o microfone.", "status-error");
    registrarLog(`Erro ao iniciar entrevista: ${mensagemErro(error)}`, "error");
    limparRecursosEntrevista();
    alternarUiDuranteEntrevista(false);
  }
}

async function finalizarEntrevista() {
  if (!estado.isInterviewRunning && !estado.filaChunks.length && !estado.filaProcessando) {
    logEvento("Finalizar solicitado sem entrevista ativa.", null, "warn");
    setStatusEntrevista("Nenhuma entrevista em andamento no momento.", "status-warning");
    return;
  }

  logEvento("Solicitação de finalização da entrevista.");
  estado.encerramentoSolicitado = true;
  refs.btnFinalizar.disabled = true;
  refs.btnIniciar.disabled = true;
  setStatusEntrevista("Finalizando entrevista...", "status-warning");

  if (estado.isInterviewRunning && estado.interviewRecorder && estado.interviewRecorder.state !== "inactive") {
    estado.interviewRecorder.stop();
  }

  if (!estado.isInterviewRunning && !estado.filaProcessando && estado.filaChunks.length === 0) {
    concluirEncerramentoEntrevista();
  }
}

async function processarFilaChunks() {
  if (estado.filaProcessando) {
    logEvento("Fila já está em processamento. Novo processamento ignorado.", null, "info");
    return;
  }

  logEvento("Iniciando processamento da fila de chunks.", { pendentes: estado.filaChunks.length });
  estado.filaProcessando = true;

  while (estado.filaChunks.length > 0) {
    const item = estado.filaChunks.shift();
    await processarChunk(item.blobOriginal, item.chunkIndex, item.chunkStartMs, item.chunkEndMs, item.tentativas);
  }

  estado.filaProcessando = false;
  logEvento("Fila de chunks processada.", { pendentes: estado.filaChunks.length });

  if (estado.encerramentoSolicitado && !estado.isInterviewRunning && estado.filaChunks.length === 0) {
    concluirEncerramentoEntrevista();
  }
}

async function processarChunk(blobOriginal, chunkIndex, chunkStartMs, chunkEndMs, tentativasIniciais = 0) {
  const duracao = Math.max(0, chunkEndMs - chunkStartMs);
  logEvento("Processando chunk.", {
    chunkIndex,
    size: blobOriginal.size,
    chunkStartMs,
    chunkEndMs,
    duracao,
    tentativasIniciais
  });
  if (estado.isInterviewRunning) {
    setStatusEntrevista(`Entrevista em andamento. Processando chunk ${chunkIndex} em paralelo...`, "status-ok");
  } else {
    setStatusEntrevista(`Processando chunk ${chunkIndex}...`, "status-warning");
  }

  try {
    const resultadoFusao = await fundirPrefixoEntrevistadorComChunk(estado.interviewerBlob, blobOriginal);
    const blobFinal = resultadoFusao.blobFinal;
    const metadados = {
      chunkIndex,
      interviewId: estado.interviewId,
      chunkStartMs,
      chunkEndMs,
      chunkDurationMs: duracao,
      hasInterviewerPrefix: resultadoFusao.hasInterviewerPrefix
    };

    const resposta = await enviarChunkParaN8nComRetry(blobFinal, metadados, tentativasIniciais);
    const textoExtraido = await garantirRespostaComTexto(
      resposta,
      blobFinal,
      metadados,
      chunkIndex,
      CHUNK_RESPOSTA_VAZIA_RETRY_MAX
    );
    logEvento("Resposta recebida do n8n para chunk.", { chunkIndex, resposta });
    estado.respostasRecebidas += 1;
    atualizarContadores();

    if (textoExtraido) {
      adicionarTranscricao(textoExtraido);
      registrarLog(`Chunk ${chunkIndex} processado e transcrição recebida.`, "success");
    } else {
      registrarLog(`Chunk ${chunkIndex} processado sem texto de transcrição reconhecido.`, "info");
    }

    if (estado.isInterviewRunning) {
      setStatusEntrevista(`Entrevista em andamento. Último chunk confirmado: ${chunkIndex}.`, "status-ok");
    } else {
      setStatusEntrevista(`Chunk ${chunkIndex} enviado com sucesso.`, "status-ok");
    }
  } catch (error) {
    logEvento("Erro ao processar chunk.", { chunkIndex, erro: mensagemErro(error) }, "error");
    const msg = `Falha ao processar chunk ${chunkIndex}: ${mensagemErro(error)}`;
    setStatusEntrevista(msg, "status-error");
    registrarLog(msg, "error");
  }
}

async function fundirPrefixoEntrevistadorComChunk(prefixBlob, chunkBlob) {
  logEvento("Iniciando fusão prefixo+chunk.", {
    prefixSize: prefixBlob?.size ?? 0,
    prefixType: prefixBlob?.type ?? "",
    chunkSize: chunkBlob?.size ?? 0,
    chunkType: chunkBlob?.type ?? ""
  });

  if (!prefixBlob) {
    logEvento("Fusão ignorada porque não há prefixo salvo.", null, "warn");
    return { blobFinal: chunkBlob, hasInterviewerPrefix: false };
  }

  /*
    Modo de produção:
    - usa concatenação binária como padrão para manter o mesmo contêiner do MediaRecorder
      e evitar variação de formato (ex.: primeiro chunk em WAV e demais em WEBM).
  */
  const mimeType = detectarMimeTypeBlob(chunkBlob, prefixBlob.type || "audio/webm");
  const blobFallback = new Blob([prefixBlob, chunkBlob], { type: mimeType });
  logEvento("Fusão binária (padrão) criada.", {
    fallbackType: mimeType,
    prefixSize: prefixBlob.size,
    chunkSize: chunkBlob.size,
    fallbackSize: blobFallback.size,
    hasInterviewerPrefix: true
  });
  return { blobFinal: blobFallback, hasInterviewerPrefix: true };
}

async function enviarChunkParaN8n(blobFinal, metadados) {
  estado.chunksEnviados += 1;
  atualizarContadores();
  logEvento("Preparando envio para n8n.", {
    metadados,
    size: blobFinal.size,
    mimeType: blobFinal.type,
    authMode: N8N_AUTH_MODE
  });

  if (MODO_SIMULADO) {
    logEvento("MODO_SIMULADO ativo. Resposta fake será usada.", { chunkIndex: metadados.chunkIndex });
    await esperar(450 + Math.random() * 400);
    return [
      {
        texto_final: `[Entrevistador]: Chunk ${metadados.chunkIndex} simulado em ${new Date().toLocaleTimeString("pt-BR")}.`,
        nome_detectado: "Entrevistador",
        tag_do_nome: "A",
        total_segmentos: 1,
        texto_completo: `Chunk ${metadados.chunkIndex} simulado em ${new Date().toLocaleTimeString("pt-BR")}.`
      }
    ];
  }

  const formData = new FormData();
  formData.append(
    "audio",
    blobFinal,
    `entrevista_chunk_${String(metadados.chunkIndex).padStart(3, "0")}.${extensaoPorMime(blobFinal.type)}`
  );
  formData.append("chunkIndex", String(metadados.chunkIndex));
  formData.append("interviewId", metadados.interviewId);
  formData.append("chunkStartMs", String(metadados.chunkStartMs));
  formData.append("chunkEndMs", String(metadados.chunkEndMs));
  formData.append("chunkDurationMs", String(metadados.chunkDurationMs));
  formData.append("hasInterviewerPrefix", String(metadados.hasInterviewerPrefix));

  const headers = montarHeadersN8n();
  const response = await fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers,
    body: formData
  });
  logEvento("Resposta HTTP recebida do n8n.", { status: response.status, ok: response.ok });

  if (!response.ok) {
    const erroTexto = await response.text().catch(() => "");
    const detalhe = erroTexto ? ` - ${limitarTexto(erroTexto, 220)}` : "";
    throw new Error(`Webhook retornou status ${response.status}${detalhe}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const corpoTexto = await response.text();
  let json = {};
  try {
    if (contentType.includes("application/json")) {
      json = corpoTexto ? JSON.parse(corpoTexto) : {};
    } else {
      json = corpoTexto ? JSON.parse(corpoTexto) : {};
    }
  } catch (error) {
    logEvento("Falha ao parsear resposta do n8n como JSON.", {
      erro: mensagemErro(error),
      contentType,
      corpo: limitarTexto(corpoTexto, 260)
    }, "error");
    throw new Error(`Resposta do webhook não veio em JSON válido: ${limitarTexto(corpoTexto, 140)}`);
  }

  logEvento("JSON do n8n parseado com sucesso.", json);
  return json;
}

async function enviarChunkParaN8nComRetry(blobFinal, metadados, tentativasIniciais = 0) {
  let tentativa = tentativasIniciais;
  let ultimoErro = null;

  while (tentativa < CHUNK_SEND_MAX_TENTATIVAS) {
    tentativa += 1;
    try {
      logEvento("Tentativa de envio de chunk.", {
        chunkIndex: metadados.chunkIndex,
        tentativa,
        maxTentativas: CHUNK_SEND_MAX_TENTATIVAS
      });
      const resposta = await enviarChunkParaN8n(blobFinal, metadados);
      if (tentativa > 1) {
        registrarLog(
          `Chunk ${metadados.chunkIndex} enviado com sucesso na tentativa ${tentativa}.`,
          "success"
        );
      }
      return resposta;
    } catch (error) {
      ultimoErro = error;
      const ultimoRound = tentativa >= CHUNK_SEND_MAX_TENTATIVAS;
      logEvento("Falha em tentativa de envio de chunk.", {
        chunkIndex: metadados.chunkIndex,
        tentativa,
        erro: mensagemErro(error),
        ultimoRound
      }, "warn");

      if (ultimoRound) {
        break;
      }

      registrarLog(
        `Chunk ${metadados.chunkIndex} falhou na tentativa ${tentativa}. Tentando novamente...`,
        "info"
      );
      await esperar(CHUNK_SEND_RETRY_MS);
    }
  }

  throw ultimoErro || new Error("Falha desconhecida no envio do chunk.");
}

async function garantirRespostaComTexto(
  respostaInicial,
  blobFinal,
  metadados,
  chunkIndex,
  maxRetriesSemTexto
) {
  let respostaAtual = respostaInicial;
  let texto = extrairTextoDaRespostaN8n(respostaAtual);

  for (let i = 0; i < maxRetriesSemTexto && !texto; i += 1) {
    const tentativaSemTexto = i + 1;
    logEvento("Resposta sem texto. Reenvio para nova tentativa de transcrição.", {
      chunkIndex,
      tentativaSemTexto,
      maxRetriesSemTexto
    }, "warn");
    registrarLog(
      `Chunk ${chunkIndex} retornou sem texto. Reenviando (${tentativaSemTexto}/${maxRetriesSemTexto})...`,
      "info"
    );
    await esperar(CHUNK_RESPOSTA_VAZIA_RETRY_MS);
    respostaAtual = await enviarChunkParaN8nComRetry(blobFinal, metadados, 0);
    texto = extrairTextoDaRespostaN8n(respostaAtual);
  }

  return texto;
}

function adicionarTranscricao(texto) {
  if (!texto) {
    return;
  }

  const textoSanitizado = removerLinhaIdentificacaoInicial(texto);
  if (!textoSanitizado) {
    logEvento("Transcrição recebida continha apenas linha de identificação e foi descartada.");
    return;
  }

  const separador = estado.transcricaoAcumulada ? "\n\n" : "";
  estado.transcricaoAcumulada += `${separador}${textoSanitizado}`;
  refs.transcriptionText.textContent = estado.transcricaoAcumulada;
  logEvento("Transcrição acumulada atualizada.", {
    tamanhoAtual: estado.transcricaoAcumulada.length
  });
}

async function copiarTranscricao() {
  if (!estado.transcricaoAcumulada.trim()) {
    logEvento("Tentativa de cópia sem transcrição disponível.", null, "warn");
    refs.copyFeedback.textContent = "Ainda não há texto de transcrição para copiar.";
    refs.copyFeedback.className = "status-text status-warning";
    return;
  }

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(estado.transcricaoAcumulada);
    } else {
      copiarViaFallbackTextarea(estado.transcricaoAcumulada);
    }
    refs.copyFeedback.textContent = "Transcrição copiada!";
    refs.copyFeedback.className = "status-text status-ok";
    logEvento("Transcrição copiada para área de transferência.");
  } catch (error) {
    logEvento("Falha ao copiar transcrição.", { erro: mensagemErro(error) }, "error");
    refs.copyFeedback.textContent = "Não foi possível copiar automaticamente. Tente novamente.";
    refs.copyFeedback.className = "status-text status-error";
  }
}

function resetarEntrevista() {
  logEvento("Reset da entrevista solicitado.");
  if (estado.interviewerRecorder && estado.interviewerRecorder.state !== "inactive") {
    estado.interviewerRecorder.stop();
  }
  if (estado.interviewRecorder && estado.interviewRecorder.state !== "inactive") {
    estado.interviewRecorder.stop();
  }

  limparRecursosIdentificacao();
  limparRecursosEntrevista();
  finalizarCronometro();

  estado.interviewerBlob = null;
  estado.interviewerMimeType = "";
  estado.interviewerChunks = [];
  estado.interviewId = "";
  estado.interviewStartMs = 0;
  estado.interviewElapsedMs = 0;
  estado.ultimoChunkFimMs = 0;
  estado.isInterviewRunning = false;
  estado.encerramentoSolicitado = false;
  estado.chunkIndex = 0;
  estado.chunksEnviados = 0;
  estado.respostasRecebidas = 0;
  estado.transcricaoAcumulada = "";
  estado.filaChunks = [];
  estado.filaProcessando = false;

  refs.btnIdentificar.textContent = "Identificar entrevistador";
  refs.btnIdentificar.disabled = false;
  refs.btnIniciar.classList.remove("hidden");
  refs.btnIniciar.disabled = false;
  refs.btnFinalizar.disabled = true;
  refs.btnResetar.classList.add("hidden");
  refs.btnCopiar.disabled = true;
  refs.recordingDot.classList.add("hidden");
  refs.recordingLabel.textContent = "Microfone inativo";
  refs.transcriptionSection.classList.add("hidden");
  refs.transcriptionText.textContent = "";
  refs.copyFeedback.textContent = "";

  definirEstadoIdentificacao("ready");
  setStatusInterviewer("Grave uma identificação curta antes de iniciar a entrevista.", "status-warning");
  setStatusEntrevista("Aguardando início da entrevista.", "status-warning");
  atualizarContadores();
  registrarLog("Entrevista resetada. Grave uma nova identificação para continuar.", "info");
}

function concluirEncerramentoEntrevista() {
  logEvento("Encerramento final concluído. Interface liberada para nova entrevista.");
  estado.encerramentoSolicitado = false;
  refs.btnFinalizar.disabled = true;
  refs.btnIniciar.classList.add("hidden");
  refs.btnResetar.classList.remove("hidden");
  refs.btnIdentificar.disabled = false;
  refs.btnCopiar.disabled = false;
  refs.recordingDot.classList.add("hidden");
  refs.recordingLabel.textContent = "Microfone inativo";
  refs.transcriptionSection.classList.remove("hidden");

  if (!estado.transcricaoAcumulada.trim()) {
    refs.transcriptionText.textContent = "Nenhuma transcrição retornada pelo backend até o momento.";
  }

  setStatusEntrevista("Entrevista finalizada. Você já pode copiar a transcrição.", "status-ok");
  registrarLog("Todos os chunks pendentes foram processados.", "success");
}

function alternarUiDuranteEntrevista(ativa) {
  refs.btnIniciar.classList.toggle("hidden", ativa);
  refs.btnIniciar.disabled = ativa;
  refs.btnFinalizar.disabled = !ativa;
  refs.btnResetar.classList.toggle("hidden", true);
  refs.btnIdentificar.disabled = ativa;
  refs.recordingDot.classList.toggle("hidden", !ativa);
  refs.recordingLabel.textContent = ativa ? "Microfone ativo" : "Microfone inativo";
  refs.transcriptionSection.classList.toggle("hidden", !ativa && !estado.transcricaoAcumulada.trim());
}

function iniciarCronometro() {
  finalizarCronometro();
  refs.tempoEntrevista.textContent = "Tempo da entrevista: 00:00";

  estado.timerInterval = window.setInterval(() => {
    estado.interviewElapsedMs = Date.now() - estado.interviewStartMs;
    refs.tempoEntrevista.textContent = `Tempo da entrevista: ${formatarTempo(estado.interviewElapsedMs)}`;
  }, 1000);
}

function finalizarCronometro() {
  if (estado.timerInterval) {
    window.clearInterval(estado.timerInterval);
    estado.timerInterval = null;
  }
}

function atualizarContadores() {
  refs.chunksEnviados.textContent = `Chunks enviados: ${estado.chunksEnviados}`;
  refs.respostasRecebidas.textContent = `Respostas recebidas: ${estado.respostasRecebidas}`;
  refs.tempoEntrevista.textContent = `Tempo da entrevista: ${formatarTempo(estado.interviewElapsedMs)}`;
}

function setStatusInterviewer(texto, classe = "") {
  refs.interviewerStatus.textContent = texto;
  refs.interviewerStatus.className = `status-text ${classe}`.trim();
}

function setStatusEntrevista(texto, classe = "") {
  refs.interviewStatus.textContent = texto;
  refs.interviewStatus.className = `status-text ${classe}`.trim();
}

function definirEstadoIdentificacao(estadoBadge) {
  if (estadoBadge === "recording") {
    refs.interviewerStateBadge.textContent = "Gravando";
    refs.interviewerStateBadge.className = "badge badge-recording";
    return;
  }

  if (estadoBadge === "done") {
    refs.interviewerStateBadge.textContent = "Concluído";
    refs.interviewerStateBadge.className = "badge badge-done";
    return;
  }

  refs.interviewerStateBadge.textContent = "Pronto";
  refs.interviewerStateBadge.className = "badge badge-ready";
}

function registrarLog(texto, tipo = "info") {
  const item = document.createElement("li");
  const horario = new Date().toLocaleTimeString("pt-BR");
  item.textContent = `[${horario}] ${texto}`;
  item.className = `log-${tipo}`;
  refs.logList.prepend(item);

  while (refs.logList.children.length > LOG_LIMITE) {
    refs.logList.removeChild(refs.logList.lastChild);
  }

  logEvento("Log UI", { tipo, texto }, tipo === "error" ? "error" : tipo === "success" ? "info" : "log");
}

function criarMediaRecorder(stream) {
  const mimeType = escolherMimeTypeSuportado();
  const options = {
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND
  };

  if (mimeType) {
    options.mimeType = mimeType;
  }

  try {
    const recorder = new MediaRecorder(stream, options);
    logEvento("MediaRecorder criado.", { mimeType: recorder.mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    return recorder;
  } catch (errorComBitrate) {
    logEvento("Falha ao criar MediaRecorder com bitrate customizado. Tentando fallback.", {
      erro: mensagemErro(errorComBitrate),
      mimeType
    }, "warn");
  }

  try {
    if (mimeType) {
      const recorderSemBitrate = new MediaRecorder(stream, { mimeType });
      logEvento("MediaRecorder criado sem bitrate explícito.", { mimeType: recorderSemBitrate.mimeType });
      return recorderSemBitrate;
    }
  } catch (errorComMime) {
    logEvento("Falha ao criar MediaRecorder com MIME específico. Tentando padrão do navegador.", {
      erro: mensagemErro(errorComMime)
    }, "warn");
  }

  const recorderPadrao = new MediaRecorder(stream);
  logEvento("MediaRecorder criado com configuração padrão do navegador.", { mimeType: recorderPadrao.mimeType });
  return recorderPadrao;
}

function escolherMimeTypeSuportado() {
  const tipos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return tipos.find((tipo) => MediaRecorder.isTypeSupported(tipo)) || "";
}

function detectarMimeTypeBlob(blob, fallback) {
  if (blob && blob.type) {
    return blob.type;
  }
  return fallback || "audio/webm";
}

function extensaoPorMime(mimeType) {
  if (mimeType.includes("mp4")) {
    return "m4a";
  }
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  if (mimeType.includes("wav")) {
    return "wav";
  }
  return "webm";
}

function criarIdEntrevista() {
  return `entrevista_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatarTempo(ms) {
  const totalSegundos = Math.max(0, Math.floor(ms / 1000));
  const minutos = String(Math.floor(totalSegundos / 60)).padStart(2, "0");
  const segundos = String(totalSegundos % 60).padStart(2, "0");
  return `${minutos}:${segundos}`;
}

function copiarViaFallbackTextarea(texto) {
  const textarea = document.createElement("textarea");
  textarea.value = texto;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function limparRecursosIdentificacao() {
  if (estado.interviewerStopTimeout) {
    window.clearTimeout(estado.interviewerStopTimeout);
    estado.interviewerStopTimeout = null;
  }

  if (estado.interviewerStream) {
    estado.interviewerStream.getTracks().forEach((track) => track.stop());
    estado.interviewerStream = null;
  }

  estado.interviewerRecorder = null;
}

function limparRecursosEntrevista() {
  if (estado.interviewStream) {
    estado.interviewStream.getTracks().forEach((track) => track.stop());
    estado.interviewStream = null;
  }

  estado.interviewRecorder = null;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mensagemErro(error) {
  if (!error) {
    return "erro desconhecido";
  }
  return error.message || String(error);
}

function logEvento(evento, dados = null, nivel = "log") {
  if (!DEBUG_LOGS) {
    return;
  }

  const prefixo = `[Entrevista ${new Date().toISOString()}] ${evento}`;
  if (nivel === "error") {
    console.error(prefixo, dados ?? "");
    return;
  }
  if (nivel === "warn") {
    console.warn(prefixo, dados ?? "");
    return;
  }
  console.log(prefixo, dados ?? "");
}

function montarHeadersN8n() {
  const headers = {};

  if (N8N_AUTH_MODE === "bearer") {
    headers.Authorization = `Bearer ${N8N_BEARER_TOKEN}`;
    return headers;
  }

  if (N8N_AUTH_MODE === "basic") {
    headers.Authorization = `Basic ${btoa(`${N8N_BASIC_USER}:${N8N_BASIC_PASS}`)}`;
    return headers;
  }

  if (N8N_AUTH_MODE === "header") {
    headers[N8N_CUSTOM_HEADER_NAME] = N8N_CUSTOM_HEADER_VALUE;
    return headers;
  }

  return headers;
}

function validarConfiguracaoAuth() {
  if (N8N_AUTH_MODE === "none") {
    return { ok: true, motivo: "" };
  }

  if (N8N_AUTH_MODE === "bearer") {
    if (!N8N_BEARER_TOKEN || N8N_BEARER_TOKEN.includes("COLOCAR_")) {
      return { ok: false, motivo: "Configure o token Bearer no script.js antes de iniciar." };
    }
    return { ok: true, motivo: "" };
  }

  if (N8N_AUTH_MODE === "basic") {
    const userInvalido = !N8N_BASIC_USER || N8N_BASIC_USER.includes("COLOCAR_");
    const passInvalida = !N8N_BASIC_PASS || N8N_BASIC_PASS.includes("COLOCAR_");
    if (userInvalido || passInvalida) {
      return { ok: false, motivo: "Configure usuário e senha Basic no script.js antes de iniciar." };
    }
    return { ok: true, motivo: "" };
  }

  if (N8N_AUTH_MODE === "header") {
    const nomeInvalido = !N8N_CUSTOM_HEADER_NAME || N8N_CUSTOM_HEADER_NAME.includes("COLOCAR_");
    const valorInvalido = !N8N_CUSTOM_HEADER_VALUE || N8N_CUSTOM_HEADER_VALUE.includes("COLOCAR_");
    if (nomeInvalido || valorInvalido) {
      return { ok: false, motivo: "Configure nome/valor do cabeçalho customizado no script.js antes de iniciar." };
    }
    return { ok: true, motivo: "" };
  }

  return {
    ok: false,
    motivo: 'N8N_AUTH_MODE inválido. Use: "none", "bearer", "basic" ou "header".'
  };
}

function limitarTexto(texto, limite) {
  if (!texto || texto.length <= limite) {
    return texto;
  }
  return `${texto.slice(0, limite)}...`;
}

function extrairTextoDaRespostaN8n(resposta) {
  if (!resposta) {
    return "";
  }

  if (Array.isArray(resposta)) {
    const textos = resposta
      .map((item) => extrairTextoDeItemN8n(item))
      .filter((texto) => !!texto);
    return textos.join("\n\n");
  }

  if (typeof resposta === "object") {
    if (Array.isArray(resposta.data)) {
      return extrairTextoDaRespostaN8n(resposta.data);
    }
    return extrairTextoDeItemN8n(resposta);
  }

  return "";
}

function extrairTextoDeItemN8n(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  const candidatos = [
    item.texto_final,
    item.transcricao,
    item.texto_completo,
    item.texto
  ];

  for (const candidato of candidatos) {
    if (typeof candidato === "string" && candidato.trim()) {
      return candidato.trim();
    }
  }

  return "";
}

function removerLinhaIdentificacaoInicial(texto) {
  const linhas = (texto || "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0);

  if (!linhas.length) {
    return "";
  }

  const primeira = linhas[0].toLowerCase();
  const contemIdentificacao =
    primeira.includes("meu nome é") ||
    primeira.includes("meu nome e") ||
    primeira.includes("me chamo") ||
    primeira.includes("eu sou");

  if (contemIdentificacao) {
    const restante = linhas.slice(1).join("\n").trim();
    logEvento("Linha inicial de identificação removida da transcrição.", {
      linhaRemovida: linhas[0],
      tamanhoRestante: restante.length
    }, "info");
    return restante;
  }

  return linhas.join("\n").trim();
}
