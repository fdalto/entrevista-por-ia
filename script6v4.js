const CALIBRACAO_MS = 4000;
const FEATURE_INTERVAL_MS = 50;
const JANELA_SEGMENTO_MS = 3000;
const RETENCAO_TIMELINE_MS = 30000;
const INTERIM_IDLE_FLUSH_MS = 1800;
const PAUSA_MAXIMA_TROCA_SPEAKER_MS = 450;
const NORMALIZAR_ESPACOS_TRANSCRICAO_FINAL = false;
const CENTROID_MIN_HZ = 80;
const CENTROID_MAX_HZ = 4000;
const PESO_MINIMO_DINAMICO = 0.03;
const EPSILON_PESO = 1e-6;
const CALIBRACAO_VOL_MIN = 0.008;
const CALIBRACAO_MIN_FRAMES_VOZ = 5;
const CALIBRACAO_SILENCIO_STOP_MS = 800;
const CALIBRACAO_VOICE_RMS_MIN = 0.012;
const SEGMENTO_VOL_MIN = 0.012;
const MAX_SOBREPOSICAO_CHARS = 320;
const INTERIM_LOG_THROTTLE_MS = 700;
const TRACE_LOG_THROTTLE_MS = 500;
const INTERIM_CORTE_MIN_DELTA = 0.1;
const INTERIM_CORTE_MIN_CONFIRMACOES = 2;
const INTERIM_CORTE_MIN_INTERVALO_MS = 500;
const INTERIM_CORTE_JANELA_MS = 900;
const INTERIM_CORTE_MIN_VOL = SEGMENTO_VOL_MIN;
const CORTE_CANDIDATO_MAX_IDADE_MS = 7000;
const CORTE_MIN_TOTAL_PALAVRAS = 6;
const CORTE_MIN_PALAVRAS_LADO = 2;
const FEATURE_KEYS = ["ch", "vol", "pit", "zcr", "cent"];
const PROMPT_IA_STORAGE_KEY = "entrevista_prompt_ia_personalizado";

const els = {
  btnCalibrarIndividuo1: document.getElementById("btnCalibrarIndividuo1"),
  btnCalibrarIndividuo2: document.getElementById("btnCalibrarIndividuo2"),
  btnIniciar: document.getElementById("btnIniciar"),
  btnFinalizar: document.getElementById("btnFinalizar"),
  btnModoDebug: document.getElementById("btnModoDebug"),
  btnEnviar: document.getElementById("btnEnviar"),
  status: document.getElementById("status"),
  cardDebug: document.getElementById("cardDebug"),
  debug: document.getElementById("debug"),
  promptEditor: document.getElementById("promptEditor"),
  campoPromptIA: document.getElementById("campoPromptIA"),
  btnSalvarPromptIA: document.getElementById("btnSalvarPromptIA"),
  resultadoGrid: document.getElementById("resultadoGrid"),
  resultadoSegmentos: document.getElementById("resultadoSegmentos"),
  colunaTranscricaoFinal: document.getElementById("colunaTranscricaoFinal"),
  transcricaoFinal: document.getElementById("transcricaoFinal")
};

const state = {
  audioContext: null,
  stream: null,
  source: null,
  splitter: null,
  analyserL: null,
  analyserR: null,
  floatL: null,
  floatR: null,
  freqL: null,
  freqR: null,
  featureTimer: null,
  timeline: [],
  ultimoFeature: null,
  recognition: null,
  recognitionRunning: false,
  entrevistaAtiva: false,
  assinaturaIndividuo1: null,
  assinaturaIndividuo2: null,
  pesosFeatures: {
    ch: 0.2,
    vol: 0.2,
    pit: 0.2,
    zcr: 0.2,
    cent: 0.2
  },
  nomeIndividuo1: "Individuo 1",
  nomeIndividuo2: "Individuo 2",
  calibrando: null,
  calibracaoBuffer: [],
  segmentosMarcados: [],
  transcricaoFinalPartes: [],
  modoDebugAtivo: false,
  interimAtual: "",
  ultimoInterimUpdateMs: 0,
  interimWatchdogTimer: null,
  ultimoInterimLogMs: 0,
  traceLastByKey: {},
  aguardandoFlushFinal: false,
  finalizarRecognitionResolve: null,
  finalizarRecognitionTimer: null,
  sessaoEntrevista: null,
  cortesCandidatos: [],
  ultimoLabelInterim: null,
  confirmacoesTrocaInterim: 0,
  trocaInterimPendente: null,
  ultimoCorteConfirmadoMs: 0,
  janelaInterimLabels: []
};

boot();

// Inicializa eventos de UI e estado base da aplicação.
function boot() {
  els.btnCalibrarIndividuo1.addEventListener("click", () => calibrar("Individuo 1"));
  els.btnCalibrarIndividuo2.addEventListener("click", () => calibrar("Individuo 2"));
  els.btnIniciar.addEventListener("click", iniciarEntrevista);
  els.btnFinalizar.addEventListener("click", finalizarEntrevista);
  els.btnModoDebug.addEventListener("click", alternarModoDebug);
  els.btnEnviar.addEventListener("click", enviarParaIA);
  els.btnSalvarPromptIA.addEventListener("click", salvarPromptIA);
  iniciarWatchdogInterim();
  carregarPromptIA();
  atualizarModoInterface();
  atualizarEstadoControles();
  setStatus("Status: pronto para calibrar.");
  debug("Sistema iniciado.");
}

// Atualiza o texto de status principal na interface.
function setStatus(texto) {
  els.status.textContent = texto;
}

// Alterna a interface entre modo normal e modo debug.
function alternarModoDebug() {
  state.modoDebugAtivo = !state.modoDebugAtivo;
  atualizarModoInterface();
  renderizarSegmentosMarcados();
}

// Aplica visibilidade e rotulos conforme o modo selecionado.
function atualizarModoInterface() {
  els.btnModoDebug.textContent = state.modoDebugAtivo ? "Ativar Modo Normal" : "Ativar Modo Debug";
  els.cardDebug.classList.toggle("is-collapsed", !state.modoDebugAtivo);
  els.debug.hidden = !state.modoDebugAtivo;
  els.promptEditor.hidden = !state.modoDebugAtivo;
  els.promptEditor.classList.toggle("is-hidden", !state.modoDebugAtivo);
  els.colunaTranscricaoFinal.hidden = !state.modoDebugAtivo;
  els.colunaTranscricaoFinal.classList.toggle("is-hidden", !state.modoDebugAtivo);
  els.resultadoGrid.classList.toggle("modo-normal", !state.modoDebugAtivo);
}

// Retorna se as duas calibracoes necessarias ja foram concluidas.
function calibracoesConcluidas() {
  return !!state.assinaturaIndividuo1 && !!state.assinaturaIndividuo2;
}

// Atualiza o estado visual dos botoes de calibracao e entrevista.
function atualizarEstadoControles() {
  const prontoParaIniciar = calibracoesConcluidas() && !state.calibrando && !state.entrevistaAtiva;
  els.btnIniciar.disabled = !prontoParaIniciar;
  els.btnFinalizar.disabled = !state.entrevistaAtiva;
  els.btnCalibrarIndividuo1.classList.toggle("calibrado", !!state.assinaturaIndividuo1);
  els.btnCalibrarIndividuo2.classList.toggle("calibrado", !!state.assinaturaIndividuo2);
}

// Escreve mensagens no painel de debug com timestamp e limite de tamanho.
function debug(texto) {
  if (texto.startsWith("interim atualizado") || texto.startsWith("trecho consolidado")) {
    const agora = Date.now();
    if (agora - state.ultimoInterimLogMs < INTERIM_LOG_THROTTLE_MS) {
      return;
    }
    state.ultimoInterimLogMs = agora;
  }
  const linha = `[${new Date().toLocaleTimeString()}] ${texto}\n`;
  els.debug.textContent = (els.debug.textContent + linha).slice(-8000);
  els.debug.scrollTop = els.debug.scrollHeight;
}

// Emite traces no console para diagnóstico técnico com throttle opcional.
function trace(etapa, dados = null, throttleKey = "") {
  const agora = Date.now();
  if (throttleKey) {
    const ultimo = state.traceLastByKey[throttleKey] || 0;
    if (agora - ultimo < TRACE_LOG_THROTTLE_MS) {
      return;
    }
    state.traceLastByKey[throttleKey] = agora;
  }
  if (!dados) {
    console.log(`[trace] ${etapa}`);
    return;
  }
  const partes = Object.entries(dados).map(([k, v]) => `${k}=${formatTraceValue(v)}`);
  console.log(`[trace] ${etapa} | ${partes.join(" | ")}`);
}

// Formata valores usados nos traces para facilitar leitura no console.
function formatTraceValue(v) {
  if (v === null || v === undefined) {
    return String(v);
  }
  if (typeof v === "number") {
    return Number.isFinite(v) ? v.toFixed(4) : String(v);
  }
  if (typeof v === "string") {
    return v.replace(/\s+/g, " ").slice(0, 180);
  }
  return String(v);
}

// Limita um valor numérico ao intervalo [min, max].
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Indica se um texto possui conteudo util, ignorando apenas espacos.
function textoTemConteudo(texto) {
  return typeof texto === "string" && texto.trim().length > 0;
}

// Prepara texto apenas para a coluna de transcricao final corrida.
function prepararTextoTranscricaoFinal(texto) {
  if (texto === null || texto === undefined) {
    return "";
  }
  const valor = String(texto);
  return NORMALIZAR_ESPACOS_TRANSCRICAO_FINAL ? valor.trim() : valor;
}

// Retorna o template padrao do prompt usado quando nao existe versao salva.
function obterTemplatePromptPadrao() {
  return `Voce recebera dois blocos de texto da mesma conversa.

BLOCO 1 - TRANSCRICAO CORRIDA FINAL:
Este bloco contem a transcricao corrida formada apenas pelos trechos finais reconhecidos pelo mecanismo de fala. Em geral, ele preserva melhor as palavras reconhecidas, mas nao identifica com seguranca quem falou cada trecho.

BLOCO 2 - SEGMENTOS MARCADOS:
Este bloco contem segmentos menores com tentativa automatica de identificar o interlocutor. Cada linha vem no formato:
{spk=..., conf=..., delta=..., ch=..., vol=..., pit=..., zcr=..., cent=...} texto

Interpretacao:

* spk: sugestao automatica de speaker. Pode vir como nome, nome com interrogacao, ou apenas "?".
* conf: confianca da classificacao local.
* delta: diferenca de distancia entre os dois perfis calibrados. Quanto maior, mais forte a distincao.
* ch: dominancia entre canais.
* vol: volume medio.
* pit: pitch aproximado.
* zcr: zero-crossing rate.
* cent: spectral centroid normalizado.
* texto: trecho associado aquela marcacao.

Sua tarefa:

1. Reconstruir a conversa completa com pontuacao adequada e linguagem natural.
2. Usar a TRANSCRICAO CORRIDA FINAL como base principal para preservar as palavras corretamente.
3. Usar os SEGMENTOS MARCADOS como apoio para identificar quem falou cada trecho.
4. Quando houver conflito entre os dois blocos, priorize o texto do BLOCO 1 e use o BLOCO 2 para orientar a atribuicao do interlocutor.
5. Quando a identificacao do interlocutor estiver incerta, inferir pelo contexto conversacional, continuidade da fala, alternancia natural entre os participantes e pelas marcacoes disponiveis.
6. Se ainda assim houver duvida real, mantenha o speaker como [Indefinido].
7. Junte fragmentos curtos quebrados quando claramente fizerem parte da mesma frase.
8. Corrija apenas pontuacao, capitalizacao e pequenas quebras de fluidez. Nao invente conteudo novo.

Saida desejada:

* Escreva a conversa em formato de dialogo.
* Um speaker por linha, por exemplo:
  [Vitor]: ...
  [Bianca]: ...
* Nao inclua explicacoes adicionais.
* Entregue apenas a conversa final organizada.

BLOCO 1 - TRANSCRICAO CORRIDA FINAL:
{{TRANSCRICAO_FINAL}}

BLOCO 2 - SEGMENTOS MARCADOS:
{{SEGMENTOS_MARCADOS}}`;
}

// Carrega do navegador um prompt salvo anteriormente ou usa o padrao.
function carregarPromptIA() {
  let promptSalvo = "";
  try {
    promptSalvo = localStorage.getItem(PROMPT_IA_STORAGE_KEY) || "";
  } catch (error) {
    debug(`Nao foi possivel ler prompt salvo: ${error.message || String(error)}`);
  }
  els.campoPromptIA.value = textoTemConteudo(promptSalvo) ? promptSalvo : obterTemplatePromptPadrao();
}

// Salva o prompt atual no armazenamento local do navegador.
function salvarPromptIA() {
  const promptAtual = els.campoPromptIA.value || "";
  try {
    localStorage.setItem(PROMPT_IA_STORAGE_KEY, promptAtual);
    setStatus("Status: prompt da IA salvo no navegador.");
    debug("Prompt da IA salvo no navegador.");
  } catch (error) {
    setStatus("Status: nao foi possivel salvar o prompt da IA.");
    debug(`Erro ao salvar prompt da IA: ${error.message || String(error)}`);
  }
}

// Retorna o template ativo digitado pelo usuario ou o padrao de fallback.
function obterTemplatePromptAtivo() {
  const promptAtual = els.campoPromptIA.value || "";
  return textoTemConteudo(promptAtual) ? promptAtual : obterTemplatePromptPadrao();
}

// Aplica os blocos da entrevista ao template editavel do prompt.
function montarPromptComBlocos(template, transcricaoFinal, segmentosMarcados) {
  const base = textoTemConteudo(template) ? template : obterTemplatePromptPadrao();
  let promptFinal = base
    .replaceAll("{{TRANSCRICAO_FINAL}}", transcricaoFinal)
    .replaceAll("{{SEGMENTOS_MARCADOS}}", segmentosMarcados);

  if (!base.includes("{{TRANSCRICAO_FINAL}}")) {
    promptFinal += `\n\nBLOCO 1 - TRANSCRICAO CORRIDA FINAL:\n${transcricaoFinal}`;
  }
  if (!base.includes("{{SEGMENTOS_MARCADOS}}")) {
    promptFinal += `\n\nBLOCO 2 - SEGMENTOS MARCADOS:\n${segmentosMarcados}`;
  }
  return promptFinal;
}

// Normaliza formatos de assinatura/feature para um vetor simples de features.
function obterVetorFeatures(v) {
  if (!v) {
    return { ch: 0, vol: 0, pit: 0, zcr: 0, cent: 0 };
  }
  if (v.medias) {
    return v.medias;
  }
  return v;
}

// Calcula distância ponderada entre dois vetores de features acústicas.
function dist(a, b) {
  const fa = obterVetorFeatures(a);
  const fb = obterVetorFeatures(b);
  const pesos = state.pesosFeatures || { ch: 0.2, vol: 0.2, pit: 0.2, zcr: 0.2, cent: 0.2 };
  return Math.sqrt(
    pesos.ch * (fa.ch - fb.ch) ** 2 +
    pesos.vol * (fa.vol - fb.vol) ** 2 +
    pesos.pit * (fa.pit - fb.pit) ** 2 +
    pesos.zcr * (fa.zcr - fb.zcr) ** 2 +
    pesos.cent * (fa.cent - fb.cent) ** 2
  );
}

// Inicializa captura de áudio, nós WebAudio e buffers de análise.
async function setupAudioEngine(opcoes = {}) {
  if (state.audioContext && state.stream && state.featureTimer) {
    return;
  }
  const forCalibration = !!opcoes.forCalibration;
  const streamExterno = opcoes.stream || null;
  const audioConstraints = forCalibration
    ? {
      channelCount: 2,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
    : {
      channelCount: 2,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    };
  if (forCalibration) {
    debug("Calibracao: preparando captura de calibracao.");
  }

  let stream = streamExterno;
  if (!stream) {
    if (forCalibration) {
      debug("Calibracao: solicitando captura com noiseSuppression=false, echoCancellation=false e autoGainControl=false.");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints
    });
  } else if (forCalibration) {
    debug("Calibracao: usando stream compartilhado para assinatura acustica.");
  }

  const audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (error) {
      debug(`Aviso ao retomar AudioContext: ${error.message || String(error)}`);
    }
  }
  const source = audioContext.createMediaStreamSource(stream);
  const splitter = audioContext.createChannelSplitter(2);
  const analyserL = audioContext.createAnalyser();
  const analyserR = audioContext.createAnalyser();
  analyserL.fftSize = 2048;
  analyserR.fftSize = 2048;
  analyserL.smoothingTimeConstant = 0.2;
  analyserR.smoothingTimeConstant = 0.2;

  source.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);

  state.audioContext = audioContext;
  state.stream = stream;
  state.source = source;
  state.splitter = splitter;
  state.analyserL = analyserL;
  state.analyserR = analyserR;
  state.floatL = new Float32Array(analyserL.fftSize);
  state.floatR = new Float32Array(analyserR.fftSize);
  state.freqL = new Float32Array(analyserL.frequencyBinCount);
  state.freqR = new Float32Array(analyserR.frequencyBinCount);
  startFeatureLoop();
  debug(forCalibration ? "Calibracao: captura acustica iniciada." : "Captura de áudio inicializada.");
}

// Libera recursos de áudio e reseta referências de captura/análise.
async function teardownAudioEngine() {
  stopFeatureLoop();
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  if (state.audioContext) {
    try {
      await state.audioContext.close();
    } catch (e) {
      debug(`Aviso ao fechar AudioContext: ${e.message || String(e)}`);
    }
  }
  state.audioContext = null;
  state.stream = null;
  state.source = null;
  state.splitter = null;
  state.analyserL = null;
  state.analyserR = null;
  state.floatL = null;
  state.floatR = null;
  state.freqL = null;
  state.freqR = null;
  state.featureTimer = null;
}

// Inicia o loop periódico de extração de features.
function startFeatureLoop() {
  if (state.featureTimer) {
    return;
  }
  state.featureTimer = window.setInterval(capturarFeature, FEATURE_INTERVAL_MS);
}

// Interrompe o loop periódico de extração de features.
function stopFeatureLoop() {
  if (!state.featureTimer) {
    return;
  }
  window.clearInterval(state.featureTimer);
  state.featureTimer = null;
}

// Captura um frame acústico e alimenta timeline/calibração.
function capturarFeature() {
  if (!state.analyserL || !state.analyserR) {
    return;
  }

  state.analyserL.getFloatTimeDomainData(state.floatL);
  state.analyserR.getFloatTimeDomainData(state.floatR);

  const rmsL = rms(state.floatL);
  const rmsR = rms(state.floatR);
  const mix = criarSinalMixado(state.floatL, state.floatR);
  const vol = clamp((rmsL + rmsR) / 2, 0, 1);
  const ch = clamp((rmsL - rmsR) / (rmsL + rmsR + 1e-6), -1, 1);
  const pit = detectarPitchNormalizado(mix, state.audioContext.sampleRate);
  const zcr = calcularZeroCrossingRate(mix);
  const cent = calcularSpectralCentroidNormalizado(
    state.analyserL,
    state.analyserR,
    state.audioContext.sampleRate
  );

  const feature = {
    time: performance.now(),
    ch,
    vol,
    pit,
    zcr,
    cent
  };
  state.ultimoFeature = feature;
  state.timeline.push(feature);

  const corte = performance.now() - RETENCAO_TIMELINE_MS;
  while (state.timeline.length && state.timeline[0].time < corte) {
    state.timeline.shift();
  }

  if (state.calibrando) {
    state.calibracaoBuffer.push(feature);
  }
}

// Calcula RMS (energia) de um buffer no domínio do tempo.
function rms(buffer) {
  let soma = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    soma += buffer[i] * buffer[i];
  }
  return Math.sqrt(soma / buffer.length);
}

// Cria um sinal mono médio a partir dos canais esquerdo/direito.
function criarSinalMixado(bufferL, bufferR) {
  const mix = new Float32Array(bufferL.length);
  for (let i = 0; i < bufferL.length; i += 1) {
    mix[i] = (bufferL[i] + bufferR[i]) * 0.5;
  }
  return mix;
}

// Estima pitch e normaliza o resultado para faixa 0..1.
function detectarPitchNormalizado(mix, sampleRate) {
  const freq = autoCorrelacaoPitch(mix, sampleRate);
  if (!freq) {
    return 0;
  }
  const minHz = 80;
  const maxHz = 350;
  const norm = (freq - minHz) / (maxHz - minHz);
  return clamp(norm, 0, 1);
}

// Estimador de pitch por autocorrelação em faixa típica de voz.
function autoCorrelacaoPitch(buffer, sampleRate) {
  const tamanho = buffer.length;
  let rmsValor = 0;
  for (let i = 0; i < tamanho; i += 1) {
    rmsValor += buffer[i] * buffer[i];
  }
  rmsValor = Math.sqrt(rmsValor / tamanho);
  if (rmsValor < 0.01) {
    return 0;
  }

  let melhorLag = -1;
  let melhorCorr = 0;
  const minLag = Math.floor(sampleRate / 350);
  const maxLag = Math.floor(sampleRate / 80);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    for (let i = 0; i < tamanho - lag; i += 1) {
      corr += buffer[i] * buffer[i + lag];
    }
    corr /= (tamanho - lag);
    if (corr > melhorCorr) {
      melhorCorr = corr;
      melhorLag = lag;
    }
  }

  if (melhorLag <= 0) {
    return 0;
  }
  return sampleRate / melhorLag;
}

// ZCR: feature temporal simples baseada em cruzamentos por zero no frame.
function calcularZeroCrossingRate(buffer) {
  if (!buffer || buffer.length < 2) {
    return 0;
  }
  let cruzamentos = 0;
  for (let i = 1; i < buffer.length; i += 1) {
    const a = buffer[i - 1];
    const b = buffer[i];
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
      cruzamentos += 1;
    }
  }
  return clamp(cruzamentos / (buffer.length - 1), 0, 1);
}

// Spectral centroid: feature espectral simples baseada no centro de massa do espectro.
function calcularSpectralCentroidNormalizado(analyserL, analyserR, sampleRate) {
  if (!analyserL || !analyserR || !state.freqL || !state.freqR) {
    return 0;
  }

  analyserL.getFloatFrequencyData(state.freqL);
  analyserR.getFloatFrequencyData(state.freqR);

  const bins = Math.min(state.freqL.length, state.freqR.length);
  if (!bins) {
    return 0;
  }

  const nyquist = sampleRate * 0.5;
  let somaPesos = 0;
  let somaFreq = 0;

  for (let i = 0; i < bins; i += 1) {
    const dbL = Number.isFinite(state.freqL[i]) ? state.freqL[i] : -160;
    const dbR = Number.isFinite(state.freqR[i]) ? state.freqR[i] : -160;
    const dbMedio = (dbL + dbR) * 0.5;
    const mag = Math.pow(10, dbMedio / 20);
    const hz = (i / Math.max(1, bins - 1)) * nyquist;
    somaPesos += mag;
    somaFreq += hz * mag;
  }

  if (somaPesos <= 0) {
    return 0;
  }

  const centroidHz = somaFreq / somaPesos;
  const normalizado = (centroidHz - CENTROID_MIN_HZ) / (CENTROID_MAX_HZ - CENTROID_MIN_HZ);
  return clamp(normalizado, 0, 1);
}

// Executa calibração em duas etapas sequenciais: primeiro voz/nome, depois assinatura acústica.
function criarSessaoAudioCompartilhada() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 2,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  }).then((rawStream) => {
    const rawTrack = rawStream.getAudioTracks()[0] || null;
    if (!rawTrack) {
      rawStream.getTracks().forEach((track) => track.stop());
      throw new Error("Nenhuma trilha de audio disponivel para calibracao.");
    }

    const analysisTrack = rawTrack.clone();
    const sttTrack = rawTrack.clone();
    const analysisStream = new MediaStream([analysisTrack]);

    const cleanup = () => {
      try {
        analysisStream.getTracks().forEach((track) => track.stop());
      } catch (e) {
        // noop
      }
      try {
        sttTrack.stop();
      } catch (e) {
        // noop
      }
      try {
        rawStream.getTracks().forEach((track) => track.stop());
      } catch (e) {
        // noop
      }
    };

    return {
      analysisStream,
      sttTrack,
      cleanup
    };
  });
}

// Executa calibracao com uma unica captura e trilhas clonadas para analise/STT.
async function calibrar(nome) {
  let audioCalibracaoAtivo = false;
  let calibracaoConcluida = false;
  let sessaoCompartilhada = null;
  let textoCalibracao = "";
  let nomeExtraido = "";
  try {
    if (state.entrevistaAtiva) {
      setStatus("Status: finalize a entrevista antes de calibrar.");
      return;
    }
    if (state.calibrando) {
      setStatus("Status: já existe calibração em andamento.");
      return;
    }

    travarControles(true);
    debug(`Calibração de ${nome} iniciada.`);

    // Captura conjunta para reconhecimento e assinatura acustica.
    setStatus(`Status: capturando nome e assinatura acustica do ${nome}...`);
    sessaoCompartilhada = await criarSessaoAudioCompartilhada();
    debug("Calibracao: stream compartilhado criado (raw + clones para analise/STT).");
    const promessaTranscricao = capturarTranscricaoCalibracao(CALIBRACAO_MS, {
      track: sessaoCompartilhada.sttTrack
    });
    await setupAudioEngine({
      forCalibration: true,
      stream: sessaoCompartilhada.analysisStream
    });
    audioCalibracaoAtivo = true;
    state.calibrando = nome;
    state.calibracaoBuffer = [];
    await new Promise((resolve) => {
      window.setTimeout(resolve, CALIBRACAO_MS);
    });
    textoCalibracao = await promessaTranscricao;
    nomeExtraido = extrairNomeDaCalibracao(textoCalibracao);
    if (!nomeExtraido) {
      setStatus("Status: nome nao identificado na calibracao; usando rotulo padrao.");
      debug("Nome nao identificado na calibracao; usando rotulo padrao.");
    }

    const framesBrutos = state.calibracaoBuffer.slice();
    const diagnosticoFrames = classificarFramesCalibracao(framesBrutos);
    const framesVoz = diagnosticoFrames.validos;
    if (framesVoz.length < CALIBRACAO_MIN_FRAMES_VOZ) {
      setStatus("Status: poucos frames de voz na calibração. Tente novamente falando mais perto e de forma contínua.");
      diagnosticarFalhaCalibracao(nome, framesBrutos, diagnosticoFrames);
      return;
    }

    const baseCalibracao = framesVoz;
    const assinatura = mediaEdesvioFeatures(baseCalibracao);
    state.calibrando = null;
    state.calibracaoBuffer = [];

    if (!assinatura) {
      setStatus(`Status: falha na calibração de ${nome}. Tente novamente.`);
      debug(`Calibração de ${nome} sem dados suficientes.`);
      return;
    }

    if (nome === "Individuo 1") {
      state.assinaturaIndividuo1 = assinatura;
      state.nomeIndividuo1 = nomeExtraido || "Individuo 1";
    } else {
      state.assinaturaIndividuo2 = assinatura;
      state.nomeIndividuo2 = nomeExtraido || "Individuo 2";
    }

    const rotuloAtual = nome === "Individuo 1" ? state.nomeIndividuo1 : state.nomeIndividuo2;
    setStatus(`Status: calibração de ${nome} concluída (${rotuloAtual}).`);
    debug(`Fala calibração ${nome}: "${textoCalibracao || "sem transcrição"}"`);
    debug(`Frames calibração ${nome}: brutos=${framesBrutos.length}, voz=${framesVoz.length}, usados=${baseCalibracao.length}`);
    debug(`Assinatura ${rotuloAtual} medias: ${formatFeatures(assinatura.medias)}`);
    debug(`Assinatura ${rotuloAtual} desvios: ${formatFeatures(assinatura.desvios)}`);
    // Recalcula pesos somente após concluir/salvar a calibração atual.
    atualizarPesosAposCalibracao();
    calibracaoConcluida = true;
  } catch (error) {
    state.calibrando = null;
    state.calibracaoBuffer = [];
    setStatus("Status: erro ao executar calibração.");
    debug(`Erro de calibração: ${error.message || String(error)}`);
  } finally {
    if (audioCalibracaoAtivo) {
      await teardownAudioEngine();
      debug(
        calibracaoConcluida
          ? "Recursos de áudio da calibração liberados."
          : "Recursos de áudio da calibração liberados após falha."
      );
    }
    if (sessaoCompartilhada) {
      try {
        sessaoCompartilhada.cleanup();
        debug("Calibracao: stream compartilhado encerrado.");
      } catch (e) {
        debug(`Aviso ao encerrar stream compartilhado: ${e.message || String(e)}`);
      }
    }
    state.calibrando = null;
    state.calibracaoBuffer = [];
    debug(
      calibracaoConcluida
        ? "Calibração concluída e estado resetado."
        : "Calibração abortada e estado resetado."
    );
    travarControles(false);
    atualizarEstadoControles();
    debug(
      calibracaoConcluida
        ? "Controles liberados após calibração."
        : "Controles destravados após falha da calibração."
    );
  }
}

// Habilita/desabilita botões conforme estado de calibração/entrevista.
function travarControles(calibrando) {
  els.btnCalibrarIndividuo1.disabled = calibrando;
  els.btnCalibrarIndividuo2.disabled = calibrando;
  atualizarEstadoControles();
}

// Calcula média simples das features para uma lista de frames.
function mediaFeatures(lista) {
  if (!lista || !lista.length) {
    return null;
  }
  let ch = 0;
  let vol = 0;
  let pit = 0;
  let zcr = 0;
  let cent = 0;
  for (let i = 0; i < lista.length; i += 1) {
    ch += lista[i].ch;
    vol += lista[i].vol;
    pit += lista[i].pit;
    zcr += lista[i].zcr || 0;
    cent += lista[i].cent || 0;
  }
  return {
    ch: ch / lista.length,
    vol: vol / lista.length,
    pit: pit / lista.length,
    zcr: zcr / lista.length,
    cent: cent / lista.length
  };
}

// Agrega features de segmento com filtro de silêncio e peso por volume.
function agregarFeaturesSegmento(lista) {
  if (!lista || !lista.length) {
    return null;
  }

  // Filtra frames com energia mínima para reduzir efeito de silêncio no trecho.
  const candidatos = lista.filter((f) => (f.vol || 0) >= SEGMENTO_VOL_MIN);
  const base = candidatos.length >= 6 ? candidatos : lista;

  let somaPeso = 0;
  const acc = { ch: 0, vol: 0, pit: 0, zcr: 0, cent: 0 };
  for (let i = 0; i < base.length; i += 1) {
    const f = base[i];
    const peso = Math.max(0.001, Math.pow(f.vol || 0, 1.4));
    somaPeso += peso;
    acc.ch += (f.ch || 0) * peso;
    acc.vol += (f.vol || 0) * peso;
    acc.pit += (f.pit || 0) * peso;
    acc.zcr += (f.zcr || 0) * peso;
    acc.cent += (f.cent || 0) * peso;
  }

  if (somaPeso <= 0) {
    return mediaFeatures(base);
  }

  return {
    ch: acc.ch / somaPeso,
    vol: acc.vol / somaPeso,
    pit: acc.pit / somaPeso,
    zcr: acc.zcr / somaPeso,
    cent: acc.cent / somaPeso
  };
}

// Calcula média e desvio padrão por feature para assinatura de calibração.
function mediaEdesvioFeatures(lista) {
  const medias = mediaFeatures(lista);
  if (!medias || !lista || !lista.length) {
    return null;
  }

  const acumulado = { ch: 0, vol: 0, pit: 0, zcr: 0, cent: 0 };
  for (let i = 0; i < lista.length; i += 1) {
    for (let k = 0; k < FEATURE_KEYS.length; k += 1) {
      const key = FEATURE_KEYS[k];
      const diff = (lista[i][key] || 0) - medias[key];
      acumulado[key] += diff * diff;
    }
  }

  const desvios = { ch: 0, vol: 0, pit: 0, zcr: 0, cent: 0 };
  for (let k = 0; k < FEATURE_KEYS.length; k += 1) {
    const key = FEATURE_KEYS[k];
    desvios[key] = Math.sqrt(acumulado[key] / lista.length);
  }

  return { medias, desvios };
}

// Filtra frames de calibração mantendo trechos com maior probabilidade de voz.
function filtrarFramesCalibracao(lista) {
  return classificarFramesCalibracao(lista).validos;
}

// Classifica frames da calibração em válidos/inválidos e contabiliza motivos de descarte.
function classificarFramesCalibracao(lista) {
  if (!lista || !lista.length) {
    return {
      validos: [],
      invalidos: [],
      descartes: { volume: 0, vozProvavel: 0, ambos: 0 }
    };
  }
  const validos = [];
  const invalidos = [];
  const descartes = { volume: 0, vozProvavel: 0, ambos: 0 };

  for (let i = 0; i < lista.length; i += 1) {
    const f = lista[i];
    const volOk = (f.vol || 0) >= CALIBRACAO_VOL_MIN;
    const vozProvavel = (f.pit || 0) > 0 || (f.zcr || 0) > 0.03;
    if (volOk && vozProvavel) {
      validos.push(f);
      continue;
    }

    invalidos.push(f);
    if (!volOk && !vozProvavel) {
      descartes.ambos += 1;
    } else if (!volOk) {
      descartes.volume += 1;
    } else {
      descartes.vozProvavel += 1;
    }
  }

  return { validos, invalidos, descartes };
}

// Emite diagnóstico detalhado para investigar falhas por poucos frames de voz na calibração.
function diagnosticarFalhaCalibracao(nome, framesBrutos, diagnosticoFrames) {
  const validos = diagnosticoFrames.validos || [];
  const invalidos = diagnosticoFrames.invalidos || [];
  const descartes = diagnosticoFrames.descartes || { volume: 0, vozProvavel: 0, ambos: 0 };
  debug(
    `Falha calibração ${nome}: brutos=${framesBrutos.length}, ` +
    `válidos=${validos.length}, inválidos=${invalidos.length}`
  );
  debug(
    `Descartes ${nome}: por volume=${descartes.volume}, ` +
    `por vozProvavel=${descartes.vozProvavel}, por ambos=${descartes.ambos}`
  );

  const mediasValidos = mediaFeatures(validos);
  const mediasInvalidos = mediaFeatures(invalidos);
  if (mediasValidos) {
    debug(`Válidos medias ${nome}: ${formatFeatures(mediasValidos)}`);
    const assinaturaValidos = mediaEdesvioFeatures(validos);
    if (assinaturaValidos) {
      debug(`Válidos desvios ${nome}: ${formatFeatures(assinaturaValidos.desvios)}`);
    }
  } else {
    debug(`Válidos medias ${nome}: sem frames válidos.`);
  }

  if (mediasInvalidos) {
    debug(`Inválidos medias ${nome}: ${formatFeatures(mediasInvalidos)}`);
    const assinaturaInvalidos = mediaEdesvioFeatures(invalidos);
    if (assinaturaInvalidos) {
      debug(`Inválidos desvios ${nome}: ${formatFeatures(assinaturaInvalidos.desvios)}`);
    }
  } else {
    debug(`Inválidos medias ${nome}: sem frames inválidos.`);
  }
}

// Normaliza scores em pesos com piso mínimo e soma final igual a 1.
function normalizarPesosComPiso(scores, pesoMin = PESO_MINIMO_DINAMICO) {
  const pesos = {};
  let soma = 0;
  for (let k = 0; k < FEATURE_KEYS.length; k += 1) {
    const key = FEATURE_KEYS[k];
    const score = Math.max(0, scores[key] || 0);
    pesos[key] = score;
    soma += score;
  }

  if (soma <= EPSILON_PESO) {
    const uniforme = 1 / FEATURE_KEYS.length;
    for (let k = 0; k < FEATURE_KEYS.length; k += 1) {
      pesos[FEATURE_KEYS[k]] = uniforme;
    }
    return pesos;
  }

  for (let k = 0; k < FEATURE_KEYS.length; k += 1) {
    const key = FEATURE_KEYS[k];
    pesos[key] = pesos[key] / soma;
  }

  // Aplica piso mínimo e renormaliza para manter soma = 1.
  const base = FEATURE_KEYS.length * pesoMin;
  const escala = Math.max(0, 1 - base);
  for (let k = 0; k < FEATURE_KEYS.length; k += 1) {
    const key = FEATURE_KEYS[k];
    pesos[key] = pesoMin + escala * pesos[key];
  }

  const somaFinal = FEATURE_KEYS.reduce((acc, key) => acc + pesos[key], 0) || 1;
  for (let k = 0; k < FEATURE_KEYS.length; k += 1) {
    const key = FEATURE_KEYS[k];
    pesos[key] /= somaFinal;
  }

  return pesos;
}

// Calcula pesos dinâmicos de features com base em separação/variabilidade.
function calcularPesosDinamicos(assinatura1, assinatura2) {
  const a1 = assinatura1?.medias ? assinatura1 : { medias: obterVetorFeatures(assinatura1), desvios: {} };
  const a2 = assinatura2?.medias ? assinatura2 : { medias: obterVetorFeatures(assinatura2), desvios: {} };
  const scores = {};
  const diffDebug = {};

  for (let k = 0; k < FEATURE_KEYS.length; k += 1) {
    const key = FEATURE_KEYS[k];
    const media1 = a1.medias[key] || 0;
    const media2 = a2.medias[key] || 0;
    const desvio1 = a1.desvios?.[key] || 0;
    const desvio2 = a2.desvios?.[key] || 0;
    const diff = Math.abs(media1 - media2);
    const variabilidade = desvio1 + desvio2 + EPSILON_PESO;
    const score = diff / variabilidade;
    scores[key] = score;
    diffDebug[key] = diff;
  }

  const pesos = normalizarPesosComPiso(scores, PESO_MINIMO_DINAMICO);
  return { pesos, scores, diffDebug };
}

// Formata pesos para exibição compacta em logs.
function formatPesos(p) {
  return `ch=${p.ch.toFixed(2)}, vol=${p.vol.toFixed(2)}, pit=${p.pit.toFixed(2)}, zcr=${p.zcr.toFixed(2)}, cent=${p.cent.toFixed(2)}`;
}

// Recalcula pesos dinâmicos após concluir calibrações dos dois indivíduos.
function atualizarPesosAposCalibracao() {
  if (!state.assinaturaIndividuo1 || !state.assinaturaIndividuo2 || state.calibrando) {
    return;
  }
  const resultado = calcularPesosDinamicos(state.assinaturaIndividuo1, state.assinaturaIndividuo2);
  state.pesosFeatures = resultado.pesos;
  debug(`Pesos recalculados após calibração concluída.`);
  debug(`Diferenças por feature: ${formatPesos(resultado.diffDebug)}`);
  debug(`Scores brutos: ${formatPesos(resultado.scores)}`);
  debug(`Pesos dinâmicos calculados: ${formatPesos(state.pesosFeatures)}`);
}

// Formata vetor de features para leitura humana no debug.
function formatFeatures(f) {
  return (
    `ch=${f.ch.toFixed(2)}, vol=${f.vol.toFixed(2)}, pit=${f.pit.toFixed(2)}, ` +
    `zcr=${f.zcr.toFixed(2)}, cent=${f.cent.toFixed(2)}`
  );
}

// Inicia entrevista, limpa estados de saída e ativa reconhecimento contínuo.
async function iniciarEntrevista() {
  if (state.entrevistaAtiva) {
    return;
  }
  if (!state.assinaturaIndividuo1 || !state.assinaturaIndividuo2) {
    setStatus("Status: calibre Individuo 1 e Individuo 2 antes de iniciar.");
    return;
  }
  let sessaoEntrevista = null;
  try {
    sessaoEntrevista = await criarSessaoAudioCompartilhada();
    state.sessaoEntrevista = sessaoEntrevista;
    debug("Entrevista: stream compartilhado criado (raw + clones para analise/STT).");
    await setupAudioEngine({
      stream: sessaoEntrevista.analysisStream
    });
    state.timeline = [];
    state.segmentosMarcados = [];
    state.transcricaoFinalPartes = [];
    state.interimAtual = "";
    state.ultimoInterimUpdateMs = 0;
    state.cortesCandidatos = [];
    state.ultimoLabelInterim = null;
    state.confirmacoesTrocaInterim = 0;
    state.trocaInterimPendente = null;
    state.ultimoCorteConfirmadoMs = 0;
    state.janelaInterimLabels = [];
    state.aguardandoFlushFinal = false;
    state.finalizarRecognitionResolve = null;
    if (state.finalizarRecognitionTimer) {
      window.clearTimeout(state.finalizarRecognitionTimer);
      state.finalizarRecognitionTimer = null;
    }
    els.resultadoSegmentos.textContent = "";
    atualizarTranscricaoFinalUI();

    try {
      iniciarRecognition({
        track: sessaoEntrevista.sttTrack
      });
    } catch (errorRecognition) {
      setStatus("Status: não foi possível iniciar a transcrição da entrevista.");
      debug(`Erro ao iniciar SpeechRecognition da entrevista: ${errorRecognition.message || String(errorRecognition)}`);
      await teardownAudioEngine();
      if (sessaoEntrevista) {
        try {
          sessaoEntrevista.cleanup();
          debug("Entrevista: stream compartilhado encerrado apos falha ao iniciar recognition.");
        } catch (e) {
          debug(`Aviso ao encerrar stream compartilhado da entrevista: ${e.message || String(e)}`);
        }
      }
      state.sessaoEntrevista = null;
      return;
    }

    state.entrevistaAtiva = true;
    atualizarEstadoControles();
    setStatus("Status: entrevista ativa (captura + transcrição contínua).");
    debug("Entrevista iniciada.");
  } catch (error) {
    if (sessaoEntrevista) {
      try {
        sessaoEntrevista.cleanup();
        debug("Entrevista: stream compartilhado encerrado apos falha de inicializacao.");
      } catch (e) {
        debug(`Aviso ao encerrar stream compartilhado da entrevista: ${e.message || String(e)}`);
      }
    }
    state.sessaoEntrevista = null;
    setStatus("Status: não foi possível iniciar a entrevista.");
    debug(`Erro ao iniciar entrevista: ${error.message || String(error)}`);
  }
}

// Configura e inicia SpeechRecognition com tratamento de eventos.
function iniciarRecognition(opcoes = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error("Web Speech API não disponível no navegador.");
  }
  const track = opcoes.track || null;

  if (state.recognition) {
    try {
      state.recognition.onresult = null;
      state.recognition.onerror = null;
      state.recognition.onend = null;
      state.recognition.stop();
    } catch (e) {
      debug(`Aviso ao reiniciar recognition: ${e.message || String(e)}`);
    }
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "pt-BR";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    trace("recognition.onresult", {
      resultIndex: event.resultIndex,
      total: event.results.length
    }, "onresult");
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const resultado = event.results[i];
      const textoBruto = resultado[0] && resultado[0].transcript ? resultado[0].transcript : "";
      const texto = textoBruto.trim();
      if (!texto) {
        continue;
      }
      if (resultado.isFinal) {
        try {
          const t0 = performance.now();
          limparCortesCandidatosAntigos(t0);
          trace("final.start", {
            idx: i,
            len: texto.length,
            preview: texto.slice(0, 140)
          });
          try {
            fecharSegmento(texto);
          } catch (error) {
            debug(`falha na marcação do segmento final, aplicando fallback '??': ${error.message || String(error)}`);
            trace("final.fecharSegmento.error", { erro: error.message || String(error) });
            marcarSegmentoIndefinido(texto);
          }
          adicionarTrechoConsolidado(prepararTextoTranscricaoFinal(textoBruto), "final");
          state.interimAtual = "";
          debug(`trecho final consolidado: ${texto}`);
          atualizarTranscricaoFinalUI();
          trace("final.done", { tempoMs: Math.round(performance.now() - t0) });
        } catch (errorFinal) {
          trace("final.error", { erro: errorFinal.message || String(errorFinal) });
          debug(`erro inesperado no processamento final: ${errorFinal.message || String(errorFinal)}`);
          marcarSegmentoIndefinido(texto);
        }
      } else {
        const textoInterim = prepararTextoTranscricaoFinal(textoBruto);
        if (state.interimAtual !== textoInterim) {
          state.interimAtual = textoInterim;
          state.ultimoInterimUpdateMs = Date.now();
          avaliarCorteDuranteInterim(textoInterim);
          debug(`interim atualizado (análise de corte, sem consolidação): ${texto}`);
          atualizarTranscricaoFinalUI();
        }
      }
    }
  };

  recognition.onerror = (event) => {
    const erro = event.error || "desconhecido";
    trace("recognition.onerror", { error: erro });
    setStatus(`Status: erro no reconhecimento de fala: ${erro}`);
    debug(`SpeechRecognition entrevista erro: ${erro}`);
  };

  recognition.onend = () => {
    trace("recognition.onend", {
      entrevistaAtiva: state.entrevistaAtiva,
      aguardandoFlushFinal: state.aguardandoFlushFinal
    });
    debug("SpeechRecognition entrevista: end");
    state.recognitionRunning = false;
    if (state.aguardandoFlushFinal && state.finalizarRecognitionResolve) {
      const resolve = state.finalizarRecognitionResolve;
      state.finalizarRecognitionResolve = null;
      if (state.finalizarRecognitionTimer) {
        window.clearTimeout(state.finalizarRecognitionTimer);
        state.finalizarRecognitionTimer = null;
      }
      state.aguardandoFlushFinal = false;
      resolve();
      return;
    }
    if (state.entrevistaAtiva) {
      try {
        if (track) {
          try {
            recognition.start(track);
          } catch (errorTrack) {
            debug(`SpeechRecognition entrevista: restart(track) indisponivel, fallback restart(). Motivo: ${errorTrack.message || String(errorTrack)}`);
            recognition.start();
          }
        } else {
          recognition.start();
        }
        state.recognitionRunning = true;
        debug("SpeechRecognition entrevista: restart");
        trace("recognition.restart.ok");
      } catch (e) {
        trace("recognition.restart.fail", { erro: e.message || String(e) });
        setStatus("Status: falha ao reiniciar reconhecimento de fala da entrevista.");
        debug(`Falha ao reiniciar recognition: ${e.message || String(e)}`);
      }
    }
  };

  try {
    if (track) {
      try {
        recognition.start(track);
        debug("SpeechRecognition entrevista: start(track)");
      } catch (errorTrack) {
        debug(`SpeechRecognition entrevista: start(track) indisponivel, fallback start(). Motivo: ${errorTrack.message || String(errorTrack)}`);
        recognition.start();
        debug("SpeechRecognition entrevista: start");
      }
    } else {
      recognition.start();
      debug("SpeechRecognition entrevista: start");
    }
    trace("recognition.start.ok");
  } catch (error) {
    setStatus("Status: não foi possível iniciar reconhecimento de fala.");
    debug(`Falha ao iniciar SpeechRecognition da entrevista: ${error.message || String(error)}`);
    trace("recognition.start.fail", { erro: error.message || String(error) });
    throw error;
  }
  state.recognition = recognition;
  state.recognitionRunning = true;
}

// Converte label numérico para nome atual calibrado.
function nomePorLabelInterim(label) {
  if (label === 1) {
    return state.nomeIndividuo1 || "Individuo 1";
  }
  if (label === 2) {
    return state.nomeIndividuo2 || "Individuo 2";
  }
  return "?";
}

// Determina label dominante e força da evidência acústica para análise de cortes.
function classificarLabelInterim(features) {
  if (!state.assinaturaIndividuo1 || !state.assinaturaIndividuo2 || !features) {
    return { label: 0, delta: 0 };
  }
  const dIndividuo1 = dist(features, state.assinaturaIndividuo1);
  const dIndividuo2 = dist(features, state.assinaturaIndividuo2);
  const delta = Math.abs(dIndividuo1 - dIndividuo2);
  return {
    label: dIndividuo1 < dIndividuo2 ? 1 : 2,
    delta
  };
}

// Remove cortes consumidos/antigos para evitar reaproveitamento indevido.
function limparCortesCandidatosAntigos(agora = performance.now()) {
  state.cortesCandidatos = state.cortesCandidatos.filter((corte) => {
    if (corte.usado) {
      return false;
    }
    return agora - corte.t <= CORTE_CANDIDATO_MAX_IDADE_MS;
  });
}

// Analisa apenas sinal interim + acústica para detectar troca provável de speaker.
function avaliarCorteDuranteInterim(textoInterim) {
  if (!textoTemConteudo(textoInterim)) {
    return;
  }
  if (!state.assinaturaIndividuo1 || !state.assinaturaIndividuo2) {
    return;
  }

  const agora = performance.now();
  limparCortesCandidatosAntigos(agora);
  const inicio = agora - INTERIM_CORTE_JANELA_MS;
  const janela = state.timeline.filter((f) => f.time >= inicio && f.time <= agora && (f.vol || 0) >= INTERIM_CORTE_MIN_VOL);
  if (janela.length < 5) {
    return;
  }

  const medias = agregarFeaturesSegmento(janela);
  const classif = classificarLabelInterim(medias);
  if (!classif.label || classif.delta < INTERIM_CORTE_MIN_DELTA) {
    return;
  }

  state.janelaInterimLabels.push({
    t: agora,
    label: classif.label,
    delta: classif.delta
  });
  if (state.janelaInterimLabels.length > 10) {
    state.janelaInterimLabels.shift();
  }

  if (!state.ultimoLabelInterim) {
    state.ultimoLabelInterim = classif.label;
    return;
  }

  if (!state.trocaInterimPendente) {
    if (classif.label !== state.ultimoLabelInterim) {
      state.trocaInterimPendente = {
        from: state.ultimoLabelInterim,
        to: classif.label,
        deltaSum: classif.delta,
        confirmacoes: 1,
        startedAt: agora,
        updatedAt: agora
      };
      state.confirmacoesTrocaInterim = 1;
    }
    return;
  }

  const pendente = state.trocaInterimPendente;
  if (classif.label === pendente.to) {
    pendente.confirmacoes += 1;
    pendente.deltaSum += classif.delta;
    pendente.updatedAt = agora;
    state.confirmacoesTrocaInterim = pendente.confirmacoes;

    const intervaloDesdeUltimoCorte = agora - state.ultimoCorteConfirmadoMs;
    if (
      pendente.confirmacoes >= INTERIM_CORTE_MIN_CONFIRMACOES &&
      intervaloDesdeUltimoCorte >= INTERIM_CORTE_MIN_INTERVALO_MS
    ) {
      const corte = {
        t: agora,
        from: nomePorLabelInterim(pendente.from),
        to: nomePorLabelInterim(pendente.to),
        fromLabel: pendente.from,
        toLabel: pendente.to,
        delta: pendente.deltaSum / pendente.confirmacoes,
        confirmacoes: pendente.confirmacoes,
        usado: false
      };
      state.cortesCandidatos.push(corte);
      state.ultimoCorteConfirmadoMs = agora;
      state.ultimoLabelInterim = pendente.to;
      state.trocaInterimPendente = null;
      state.confirmacoesTrocaInterim = 0;
      debug(
        `corte candidato detectado: ${corte.from} -> ${corte.to}, ` +
        `delta=${corte.delta.toFixed(2)}, confirmacoes=${corte.confirmacoes}`
      );
    }
    return;
  }

  if (classif.label === pendente.from) {
    state.trocaInterimPendente = null;
    state.confirmacoesTrocaInterim = 0;
    return;
  }

  state.trocaInterimPendente = {
    from: state.ultimoLabelInterim,
    to: classif.label,
    deltaSum: classif.delta,
    confirmacoes: 1,
    startedAt: agora,
    updatedAt: agora
  };
  state.confirmacoesTrocaInterim = 1;
}

// Aplica um único corte candidato ao bloco final quando plausível.
function quebrarSegmentoPorCorteCandidato(textoFinal, janela) {
  if (!state.cortesCandidatos.length || !janela.length) {
    return [];
  }
  const palavras = (textoFinal || "").split(/\s+/).filter(Boolean);
  if (palavras.length < CORTE_MIN_TOTAL_PALAVRAS) {
    return [];
  }

  const inicioJanela = janela[0].time;
  const fimJanela = janela[janela.length - 1].time;
  if (!(Number.isFinite(inicioJanela) && Number.isFinite(fimJanela)) || fimJanela <= inicioJanela) {
    return [];
  }

  limparCortesCandidatosAntigos(fimJanela);
  const candidatosJanela = state.cortesCandidatos.filter(
    (corte) => !corte.usado && corte.t >= inicioJanela && corte.t <= fimJanela
  );
  if (!candidatosJanela.length) {
    return [];
  }

  candidatosJanela.sort((a, b) => {
    const scoreA = a.confirmacoes * a.delta;
    const scoreB = b.confirmacoes * b.delta;
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return b.t - a.t;
  });
  const corte = candidatosJanela[0];

  const proporcao = clamp((corte.t - inicioJanela) / (fimJanela - inicioJanela), 0, 1);
  let indicePalavra = Math.round(palavras.length * proporcao);
  indicePalavra = clamp(indicePalavra, CORTE_MIN_PALAVRAS_LADO, palavras.length - CORTE_MIN_PALAVRAS_LADO);
  if (
    indicePalavra <= CORTE_MIN_PALAVRAS_LADO - 1 ||
    indicePalavra >= palavras.length - CORTE_MIN_PALAVRAS_LADO + 1
  ) {
    debug("corte candidato descartado por estar muito próximo da borda.");
    corte.usado = true;
    return [];
  }

  const textoA = palavras.slice(0, indicePalavra).join(" ").trim();
  const textoB = palavras.slice(indicePalavra).join(" ").trim();
  if (!textoTemConteudo(textoA) || !textoTemConteudo(textoB)) {
    debug("corte candidato descartado por gerar lado vazio.");
    corte.usado = true;
    return [];
  }

  const framesAntes = janela.filter((f) => f.time <= corte.t);
  const framesDepois = janela.filter((f) => f.time > corte.t);
  if (framesAntes.length < 3 || framesDepois.length < 3) {
    debug("corte candidato descartado por falta de frames após divisão.");
    corte.usado = true;
    return [];
  }

  const mediasA = agregarFeaturesSegmento(framesAntes) || state.ultimoFeature || { ch: 0, vol: 0, pit: 0, zcr: 0, cent: 0 };
  const mediasB = agregarFeaturesSegmento(framesDepois) || state.ultimoFeature || { ch: 0, vol: 0, pit: 0, zcr: 0, cent: 0 };
  const classifA = classificarSegmento(mediasA);
  const classifB = classificarSegmento(mediasB);

  corte.usado = true;
  limparCortesCandidatosAntigos(performance.now());
  return [
    {
      spk: classifA.spk,
      conf: classifA.conf,
      delta: classifA.delta,
      ch: mediasA.ch,
      vol: mediasA.vol,
      pit: mediasA.pit,
      zcr: mediasA.zcr,
      cent: mediasA.cent,
      texto: textoA
    },
    {
      spk: classifB.spk,
      conf: classifB.conf,
      delta: classifB.delta,
      ch: mediasB.ch,
      vol: mediasB.vol,
      pit: mediasB.pit,
      zcr: mediasB.zcr,
      cent: mediasB.cent,
      texto: textoB
    }
  ];
}

// Gera segmento classificado a partir de texto final e janela acústica recente.
function fecharSegmento(textoFinal) {
  console.log("[diag] executando funcao fecharSegmento");
  trace("fecharSegmento.start", { timeline: state.timeline.length, textoLen: (textoFinal || "").length }, "fechar");
  const agora = performance.now();
  const inicioJanela = agora - JANELA_SEGMENTO_MS;
  const janela = state.timeline.filter((f) => f.time >= inicioJanela && f.time <= agora);

  const subsegmentosPorCorte = quebrarSegmentoPorCorteCandidato(textoFinal, janela);
  if (subsegmentosPorCorte.length) {
    debug("corte candidato aplicado ao bloco final.");
    for (let i = 0; i < subsegmentosPorCorte.length; i += 1) {
      state.segmentosMarcados.push(subsegmentosPorCorte[i]);
      appendSegmentoMarcado(subsegmentosPorCorte[i]);
    }
    return;
  }
  debug("sem corte candidato plausível; mantendo bloco final único.");

  const medias = agregarFeaturesSegmento(janela) || state.ultimoFeature || { ch: 0, vol: 0, pit: 0, zcr: 0, cent: 0 };
  const classif = classificarSegmento(medias);
  const unico = {
    spk: classif.spk,
    conf: classif.conf,
    delta: classif.delta,
    ch: medias.ch,
    vol: medias.vol,
    pit: medias.pit,
    zcr: medias.zcr,
    cent: medias.cent,
    texto: textoFinal
  };
  state.segmentosMarcados.push(unico);
  appendSegmentoMarcado(unico);
  debug(
    `segmento final: spk=${unico.spk}, delta=${unico.delta.toFixed(2)}, ` +
    `zcr=${unico.zcr.toFixed(2)}, cent=${unico.cent.toFixed(2)}`
  );
}

// Classifica speaker comparando distância do trecho para cada assinatura.
function classificarSegmento(features) {
  console.log("[diag] executando funcao classificarSegmento");
  const assinaturaIndividuo1 = state.assinaturaIndividuo1;
  const assinaturaIndividuo2 = state.assinaturaIndividuo2;

  if (!assinaturaIndividuo1 || !assinaturaIndividuo2) {
    return { spk: "?", conf: 0, delta: 0 };
  }

  const dIndividuo1 = dist(features, assinaturaIndividuo1);
  const dIndividuo2 = dist(features, assinaturaIndividuo2);
  const delta = Math.abs(dIndividuo1 - dIndividuo2);
  trace("classificarSegmento.dist", { dIndividuo1, dIndividuo2, delta }, "classif");
  const conf = clamp(delta / 0.8, 0, 1);

  const nome1 = state.nomeIndividuo1 || "Individuo 1";
  const nome2 = state.nomeIndividuo2 || "Individuo 2";
  let base = dIndividuo1 < dIndividuo2 ? nome1 : nome2;
  if (delta < 0.08) {
    base = "?";
  } else if (delta < 0.2) {
    base = `${base}?`;
  }

  return { spk: base, conf, delta };
}

// Renderiza uma linha de segmento marcado na coluna da esquerda.
function appendSegmentoMarcado(seg) {
  const linha = document.createElement("div");
  linha.className = "linha-segmento";
  linha.textContent = formatarLinhaSegmento(seg);
  els.resultadoSegmentos.appendChild(linha);
  els.resultadoSegmentos.scrollTop = els.resultadoSegmentos.scrollHeight;
}

// Monta a linha de segmento conforme o modo visual ativo.
function formatarLinhaSegmento(seg) {
  if (!state.modoDebugAtivo) {
    return `{${seg.spk}} ${seg.texto}`;
  }
  return (
    `{spk=${seg.spk}, conf=${seg.conf.toFixed(2)}, delta=${seg.delta.toFixed(2)}, ` +
    `ch=${seg.ch.toFixed(2)}, vol=${seg.vol.toFixed(2)}, pit=${seg.pit.toFixed(2)}, ` +
    `zcr=${seg.zcr.toFixed(2)}, cent=${seg.cent.toFixed(2)}} ${seg.texto}`
  );
}

// Re-renderiza os segmentos marcados quando o modo de visualizacao muda.
function renderizarSegmentosMarcados() {
  els.resultadoSegmentos.textContent = "";
  for (let i = 0; i < state.segmentosMarcados.length; i += 1) {
    appendSegmentoMarcado(state.segmentosMarcados[i]);
  }
}

// Finaliza entrevista com flush de recognition/interim e teardown de áudio.
async function finalizarEntrevista() {
  if (!state.entrevistaAtiva) {
    return;
  }

  state.entrevistaAtiva = false;
  atualizarEstadoControles();

  await aguardarParadaRecognition();
  flushInterimFinalSeNecessario();

  await teardownAudioEngine();
  if (state.sessaoEntrevista) {
    try {
      state.sessaoEntrevista.cleanup();
      debug("Entrevista: stream compartilhado encerrado.");
    } catch (e) {
      debug(`Aviso ao encerrar stream compartilhado da entrevista: ${e.message || String(e)}`);
    }
  }
  state.sessaoEntrevista = null;
  state.recognitionRunning = false;
  atualizarEstadoControles();
  setStatus("Status: entrevista finalizada.");
  debug("Entrevista finalizada e recursos liberados.");
}

// Monta prompt completo e copia para clipboard para uso em IA.
async function enviarParaIA() {
  const promptMontado = montarPromptParaIAEditavel();
  try {
    await copiarTextoParaClipboard(promptMontado);
    setStatus("Status: prompt para IA copiado para a área de transferência.");
    debug("Prompt para IA montado e copiado para a área de transferência.");
    console.log(promptMontado);
  } catch (error) {
    setStatus("Status: falha ao copiar o prompt para a área de transferência.");
    debug(`Erro ao copiar prompt para IA: ${error.message || String(error)}`);
  }
}

// Atualiza coluna de transcrição corrida usando somente texto oficial consolidado.
function atualizarTranscricaoFinalUI() {
  const consolidado = obterTranscricaoFinalConsolidada();
  els.transcricaoFinal.innerText = consolidado;
  els.transcricaoFinal.scrollTop = els.transcricaoFinal.scrollHeight;
}

// Retorna o texto consolidado final da transcrição corrida.
function obterTranscricaoFinalConsolidada() {
  return NORMALIZAR_ESPACOS_TRANSCRICAO_FINAL
    ? state.transcricaoFinalPartes.join(" ").trim()
    : state.transcricaoFinalPartes.join("");
}

// Aguarda parada do recognition com fallback por timeout curto.
async function aguardarParadaRecognition() {
  if (!state.recognition || !state.recognitionRunning) {
    return;
  }

  state.aguardandoFlushFinal = true;
  await new Promise((resolve) => {
    let resolvido = false;

    const concluir = () => {
      if (resolvido) {
        return;
      }
      resolvido = true;
      state.finalizarRecognitionResolve = null;
      state.aguardandoFlushFinal = false;
      if (state.finalizarRecognitionTimer) {
        window.clearTimeout(state.finalizarRecognitionTimer);
        state.finalizarRecognitionTimer = null;
      }
      resolve();
    };

    state.finalizarRecognitionResolve = concluir;
    state.finalizarRecognitionTimer = window.setTimeout(() => {
      debug("timeout aguardando onend do recognition para flush final.");
      concluir();
    }, 1000);

    try {
      state.recognition.stop();
    } catch (e) {
      debug(`Aviso ao parar recognition: ${e.message || String(e)}`);
      concluir();
    }
  });
}

// Limpa interim pendente sem promover texto parcial para consolidado oficial.
function flushInterimFinalSeNecessario() {
  console.log("[diag] executando funcao flushInterimFinalSeNecessario");
  const trecho = prepararTextoTranscricaoFinal(state.interimAtual || "");
  if (!textoTemConteudo(trecho)) {
    console.log("[ovl] flushInterim skip: vazio");
    trace("flushInterim.skip", { motivo: "interim_vazio" });
    return;
  }
  console.log("[ovl] flushInterim start:", trecho.slice(0, 120));
  trace("flushInterim.start", {
    interimLen: trecho.length,
    interimPreview: trecho.slice(0, 140),
    partesAntes: state.transcricaoFinalPartes.length,
    consolidadoAntesLen: obterTranscricaoFinalConsolidada().length
  });
  state.interimAtual = "";
  state.ultimoInterimUpdateMs = 0;
  debug("interim descartado no encerramento (não consolidado).");
  atualizarTranscricaoFinalUI();
  console.log("[ovl] flushInterim done: partes=", state.transcricaoFinalPartes.length);
  trace("flushInterim.done", {
    partesDepois: state.transcricaoFinalPartes.length,
    consolidadoDepoisLen: obterTranscricaoFinalConsolidada().length
  });
}

// Monitor de interim ocioso somente para observação; nunca consolida texto parcial.
function iniciarWatchdogInterim() {
  if (state.interimWatchdogTimer) {
    return;
  }
  state.interimWatchdogTimer = window.setInterval(() => {
    if (!state.entrevistaAtiva) {
      return;
    }
    if (!state.interimAtual || !state.interimAtual.trim()) {
      return;
    }
    const paradoMs = Date.now() - (state.ultimoInterimUpdateMs || 0);
    if (paradoMs < INTERIM_IDLE_FLUSH_MS) {
      return;
    }
    debug(`interim parado por ${paradoMs}ms (analisado apenas para corte, não para consolidação).`);
    state.interimAtual = "";
    state.ultimoInterimUpdateMs = 0;
  }, 450);
}

// Consolida novo trecho na transcrição final com estratégia de merge por sobreposição.
function adicionarTrechoConsolidado(texto, origem = "desconhecida") {
  console.log(`[diag] executando funcao adicionarTrechoConsolidado (${origem})`);
  const trecho = prepararTextoTranscricaoFinal(texto);
  if (!textoTemConteudo(trecho)) {
    console.log(`[ovl] consolidacao skip (${origem}): vazio`);
    trace("consolidacao.skip", { origem, motivo: "trecho_vazio" });
    return;
  }
  console.log(`[ovl] consolidacao start (${origem}): len=${trecho.length}`);
  trace("consolidacao.start", {
    origem,
    trechoLen: trecho.length,
    trechoPreview: trecho.slice(0, 140),
    partesAntes: state.transcricaoFinalPartes.length
  });

  if (!state.transcricaoFinalPartes.length) {
    state.transcricaoFinalPartes.push(trecho);
    debug(`trecho consolidado (${origem}): +${trecho.length} chars`);
    console.log(`[ovl] consolidacao first_insert (${origem})`);
    trace("consolidacao.first_insert", { origem, partesDepois: state.transcricaoFinalPartes.length });
    return;
  }

  if (!NORMALIZAR_ESPACOS_TRANSCRICAO_FINAL) {
    state.transcricaoFinalPartes.push(`\n\n${trecho}`);
    debug(`trecho consolidado (${origem}) em nova parte sem normalizacao.`);
    console.log(`[ovl] consolidacao append_raw (${origem})`);
    trace("consolidacao.append_raw", { origem, partesDepois: state.transcricaoFinalPartes.length });
    return;
  }

  const ultimo = state.transcricaoFinalPartes[state.transcricaoFinalPartes.length - 1];
  const resultadoMerge = combinarComSobreposicao(ultimo, trecho);
  trace("sobreposicao.resultado", {
    origem,
    houve: resultadoMerge.houveSobreposicao,
    nTokens: resultadoMerge.overlapTokens,
    lastLen: ultimo.length,
    novoLen: trecho.length,
    saidaLen: resultadoMerge.texto.length
  });
  console.log(
    `[ovl] sobreposicao resultado (${origem}): houve=${resultadoMerge.houveSobreposicao} ` +
    `tokens=${resultadoMerge.overlapTokens} lastLen=${ultimo.length} novoLen=${trecho.length}`
  );

  if (resultadoMerge.houveSobreposicao) {
    state.transcricaoFinalPartes[state.transcricaoFinalPartes.length - 1] = resultadoMerge.texto;
    debug(`trecho consolidado (${origem}) com sobreposição real.`);
    console.log(`[ovl] consolidacao merge (${origem})`);
    trace("consolidacao.merge", {
      origem,
      overlapTokens: resultadoMerge.overlapTokens,
      partesDepois: state.transcricaoFinalPartes.length
    });
    return;
  }

  state.transcricaoFinalPartes.push(trecho);
  debug(`trecho consolidado (${origem}) em nova parte.`);
  console.log(`[ovl] consolidacao append (${origem})`);
  trace("consolidacao.append", { origem, partesDepois: state.transcricaoFinalPartes.length });
}

// Combina dois trechos detectando sobreposição textual no fim/início.
function combinarComSobreposicao(base, novo) {
  console.log("[diag] executando funcao combinarComSobreposicao");
  console.log("[ovl] combinar start:", {
    baseLen: (base || "").length,
    novoLen: (novo || "").length
  });
  const a = (base || "").trim();
  const b = (novo || "").trim();
  if (!a) {
    console.log("[ovl] combinar pass: base_vazia");
    trace("sobreposicao.pass", { regra: "base_vazia", saida: "novo" }, "sobreposicao_pass");
    return { texto: b, houveSobreposicao: false, overlapTokens: 0 };
  }
  if (!b) {
    console.log("[ovl] combinar pass: novo_vazio");
    trace("sobreposicao.pass", { regra: "novo_vazio", saida: "base" }, "sobreposicao_pass");
    return { texto: a, houveSobreposicao: false, overlapTokens: 0 };
  }

  if (a === b) {
    console.log("[ovl] combinar match: identico");
    trace("sobreposicao.caso-identico", { len: a.length }, "sobreposicao_eq");
    return { texto: a, houveSobreposicao: true, overlapTokens: -1 };
  }
  if (a.endsWith(b)) {
    console.log("[ovl] combinar match: sufixo");
    trace("sobreposicao.caso-sufixo", { baseLen: a.length, novoLen: b.length }, "sobreposicao_suffix");
    return { texto: a, houveSobreposicao: true, overlapTokens: -1 };
  }
  if (b.startsWith(a)) {
    console.log("[ovl] combinar match: prefixo");
    trace("sobreposicao.caso-prefixo", { baseLen: a.length, novoLen: b.length }, "sobreposicao_prefix");
    return { texto: b, houveSobreposicao: true, overlapTokens: -1 };
  }

  // Limita a região analisada para evitar custo alto com conversas longas.
  const aTail = a.slice(-MAX_SOBREPOSICAO_CHARS);
  const bHead = b.slice(0, MAX_SOBREPOSICAO_CHARS);
  const tokA = aTail.split(/\s+/);
  const tokB = bHead.split(/\s+/);
  trace("sobreposicao.check", {
    baseTailLen: aTail.length,
    novoHeadLen: bHead.length,
    tokA: tokA.length,
    tokB: tokB.length
  }, "sobreposicao_check");

  const maxOverlap = Math.min(tokA.length, tokB.length, 10);
  for (let n = maxOverlap; n >= 1; n -= 1) {
    const sufixo = tokA.slice(-n).join(" ").toLowerCase();
    const prefixo = tokB.slice(0, n).join(" ").toLowerCase();
    if (sufixo === prefixo) {
      const combinado = `${a} ${tokB.slice(n).join(" ")}`.trim();
      console.log(`[ovl] combinar match: tokens=${n}`);
      trace("sobreposicao.match", { nTokens: n, maxOverlap }, "sobreposicao_match");
      return { texto: combinado, houveSobreposicao: true, overlapTokens: n };
    }
  }

  console.log("[ovl] combinar fail: sem_match");
  trace("sobreposicao.fail", {
    regra: "sem_match",
    maxOverlap,
    baseTailPreview: aTail.slice(-120),
    novoHeadPreview: bHead.slice(0, 120)
  }, "sobreposicao_fail");
  return { texto: `${a} ${b}`.trim(), houveSobreposicao: false, overlapTokens: 0 };
}

// Fallback de segurança: cria segmento indefinido quando classificação falha.
function marcarSegmentoIndefinido(textoFinal) {
  const fallback = {
    spk: "??",
    conf: 0,
    delta: 0,
    ch: 0,
    vol: 0,
    pit: 0,
    zcr: 0,
    cent: 0,
    texto: (textoFinal || "").trim()
  };
  state.segmentosMarcados.push(fallback);
  appendSegmentoMarcado(fallback);
}

// Gera o prompt final para IA com bloco corrido + segmentos marcados.
function montarPromptParaIA() {
  const transcricaoFinal = obterTranscricaoFinalConsolidada();
  const segmentosMarcados = (els.resultadoSegmentos.innerText || "").trim();

  return `Você receberá dois blocos de texto da mesma conversa.

BLOCO 1 — TRANSCRIÇÃO CORRIDA FINAL:
Este bloco contém a transcrição corrida formada apenas pelos trechos finais reconhecidos pelo mecanismo de fala. Em geral, ele preserva melhor as palavras reconhecidas, mas não identifica com segurança quem falou cada trecho.

BLOCO 2 — SEGMENTOS MARCADOS:
Este bloco contém segmentos menores com tentativa automática de identificar o interlocutor. Cada linha vem no formato:
{spk=..., conf=..., delta=..., ch=..., vol=..., pit=..., zcr=..., cent=...} texto

Interpretação:

* spk: sugestão automática de speaker. Pode vir como nome, nome com interrogação, ou apenas "?".
* conf: confiança da classificação local.
* delta: diferença de distância entre os dois perfis calibrados. Quanto maior, mais forte a distinção.
* ch: dominância entre canais.
* vol: volume médio.
* pit: pitch aproximado.
* zcr: zero-crossing rate.
* cent: spectral centroid normalizado.
* texto: trecho associado àquela marcação.

Sua tarefa:

1. Reconstruir a conversa completa com pontuação adequada e linguagem natural.
2. Usar a TRANSCRIÇÃO CORRIDA FINAL como base principal para preservar as palavras corretamente.
3. Usar os SEGMENTOS MARCADOS como apoio para identificar quem falou cada trecho.
4. Quando houver conflito entre os dois blocos, priorize o texto do BLOCO 1 e use o BLOCO 2 para orientar a atribuição do interlocutor.
5. Quando a identificação do interlocutor estiver incerta, inferir pelo contexto conversacional, continuidade da fala, alternância natural entre os participantes e pelas marcações disponíveis.
6. Se ainda assim houver dúvida real, mantenha o speaker como [Indefinido].
7. Junte fragmentos curtos quebrados quando claramente fizerem parte da mesma frase.
8. Corrija apenas pontuação, capitalização e pequenas quebras de fluidez. Não invente conteúdo novo.

Saída desejada:

* Escreva a conversa em formato de diálogo.
* Um speaker por linha, por exemplo:
  [Vitor]: ...
  [Bianca]: ...
* Não inclua explicações adicionais.
* Entregue apenas a conversa final organizada.

BLOCO 1 — TRANSCRIÇÃO CORRIDA FINAL:
${transcricaoFinal}

BLOCO 2 — SEGMENTOS MARCADOS:
${segmentosMarcados}`;
}

// Copia texto para clipboard com fallback automático quando necessário.
function montarPromptParaIAEditavel() {
  const transcricaoFinal = obterTranscricaoFinalConsolidada();
  const segmentosMarcados = (els.resultadoSegmentos.innerText || "").trim();
  const templatePrompt = obterTemplatePromptAtivo();
  return montarPromptComBlocos(templatePrompt, transcricaoFinal, segmentosMarcados);
}

async function copiarTextoParaClipboard(texto) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(texto);
      return;
    } catch (error) {
      copiarTextoFallback(texto);
      return;
    }
  }
  copiarTextoFallback(texto);
}

// Fallback de cópia via textarea + execCommand.
function copiarTextoFallback(texto) {
  const textarea = document.createElement("textarea");
  textarea.value = texto;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) {
    throw new Error("document.execCommand('copy') retornou false.");
  }
}

// Tenta quebrar um texto final em subsegmentos quando há troca clara de speaker.
function quebrarSegmentoPorTrocaDeSpeaker(textoFinal, janela) {
  console.log("[diag] executando funcao quebrarSegmentoPorTrocaDeSpeaker");
  if (!state.assinaturaIndividuo1 || !state.assinaturaIndividuo2) {
    return [];
  }
  const palavras = textoFinal.split(/\s+/).filter(Boolean);
  if (palavras.length < 5 || !janela.length) {
    return [];
  }

  const frames = [];
  for (let i = 0; i < janela.length; i += 1) {
    const f = janela[i];
    if (f.vol < 0.02) {
      continue;
    }
    const d1 = dist(f, state.assinaturaIndividuo1);
    const d2 = dist(f, state.assinaturaIndividuo2);
    const delta = Math.abs(d1 - d2);
    if (delta < 0.03) {
      continue;
    }
    frames.push({
      label: d1 < d2 ? 1 : 2,
      delta,
      time: f.time,
      feature: f
    });
  }

  if (frames.length < 8) {
    return [];
  }

  const runs = [];
  for (let i = 0; i < frames.length; i += 1) {
    const atual = frames[i];
    const ultimo = runs[runs.length - 1];
    if (!ultimo || ultimo.label !== atual.label) {
      runs.push({
        label: atual.label,
        count: 1,
        deltaSum: atual.delta,
        features: [atual.feature],
        startTime: atual.time,
        endTime: atual.time
      });
    } else {
      ultimo.count += 1;
      ultimo.deltaSum += atual.delta;
      ultimo.features.push(atual.feature);
      ultimo.endTime = atual.time;
    }
  }

  const runsFiltrados = runs.filter((r) => r.count >= 3);
  if (runsFiltrados.length < 2) {
    return [];
  }

  for (let i = 1; i < runsFiltrados.length; i += 1) {
    const anterior = runsFiltrados[i - 1];
    const atual = runsFiltrados[i];
    const gapMs = (atual.startTime || 0) - (anterior.endTime || 0);
    if (gapMs > PAUSA_MAXIMA_TROCA_SPEAKER_MS) {
      trace("subsegmento.skip_gap", {
        gapMs,
        anterior: anterior.label,
        atual: atual.label
      });
      debug(
        `troca ignorada por pausa de ${Math.round(gapMs)}ms entre speakers candidatos.`
      );
      return [];
    }
  }

  const alternancia = runsFiltrados.some((r, i) => i > 0 && runsFiltrados[i - 1].label !== r.label);
  if (!alternancia) {
    return [];
  }

  const totalFrames = runsFiltrados.reduce((acc, r) => acc + r.count, 0);
  const limiteRuns = Math.min(runsFiltrados.length, 3);
  const usados = runsFiltrados.slice(0, limiteRuns);
  const segmentos = [];
  let cursorPalavra = 0;

  for (let i = 0; i < usados.length; i += 1) {
    const run = usados[i];
    const restante = palavras.length - cursorPalavra;
    const proporcao = run.count / totalFrames;
    let qtdPalavras = i === usados.length - 1 ? restante : Math.max(1, Math.round(palavras.length * proporcao));
    qtdPalavras = Math.min(qtdPalavras, restante);
    if (qtdPalavras <= 0) {
      continue;
    }

    const texto = palavras.slice(cursorPalavra, cursorPalavra + qtdPalavras).join(" ");
    cursorPalavra += qtdPalavras;
    const medias = agregarFeaturesSegmento(run.features) || state.ultimoFeature || { ch: 0, vol: 0, pit: 0, zcr: 0, cent: 0 };
    const nome = run.label === 1 ? state.nomeIndividuo1 : state.nomeIndividuo2;
    const conf = clamp((run.deltaSum / run.count) / 0.8, 0, 1);

    segmentos.push({
      spk: nome,
      conf,
      delta: run.deltaSum / run.count,
      ch: medias.ch,
      vol: medias.vol,
      pit: medias.pit,
      zcr: medias.zcr,
      cent: medias.cent,
      texto
    });
    debug(
      `subsegmento: spk=${nome}, delta=${(run.deltaSum / run.count).toFixed(2)}, ` +
      `zcr=${medias.zcr.toFixed(2)}, cent=${medias.cent.toFixed(2)}`
    );
  }

  return segmentos;
}

// Captura transcrição curta durante calibração para extrair nome falado.
function capturarTranscricaoCalibracaoLegacy(duracaoMs, opcoes = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    debug("Web Speech API indisponível para extrair nome na calibração.");
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    const recognition = new SpeechRecognition();
    let textoFinal = "";
    let finalizado = false;
    let audioContext = null;
    let monitorStream = null;
    let monitorSource = null;
    let analyser = null;
    let monitorTimer = null;
    let timeoutStopTimer = null;
    let hasVoice = false;
    let ultimoSomMs = 0;
    const amostra = new Float32Array(1024);

    const limparMonitorAudio = async () => {
      if (monitorTimer) {
        window.clearInterval(monitorTimer);
        monitorTimer = null;
      }
      if (timeoutStopTimer) {
        window.clearTimeout(timeoutStopTimer);
        timeoutStopTimer = null;
      }
      if (monitorSource) {
        try {
          monitorSource.disconnect();
        } catch (e) {
          // noop
        }
      }
      monitorSource = null;
      if (monitorStream) {
        monitorStream.getTracks().forEach((t) => t.stop());
      }
      monitorStream = null;
      if (audioContext) {
        try {
          await audioContext.close();
        } catch (e) {
          // noop
        }
      }
      audioContext = null;
      analyser = null;
    };

    const finalizar = async () => {
      if (finalizado) {
        return;
      }
      finalizado = true;
      await limparMonitorAudio();
      // Retorna apenas resultados finais para evitar ruído de transcrição parcial.
      resolve(textoFinal.trim());
    };

    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const resultado = event.results[i];
        const texto = (resultado[0] && resultado[0].transcript ? resultado[0].transcript : "").trim();
        if (!texto) {
          continue;
        }
        if (resultado.isFinal) {
          textoFinal = `${textoFinal} ${texto}`.trim();
        }
      }
    };

    recognition.onerror = (event) => {
      const erro = event && event.error ? event.error : "desconhecido";
      debug(`SpeechRecognition calibração erro: ${erro}`);
      setStatus(`Status: erro na calibração por voz: ${erro}`);
      finalizeErrorSafe();
    };

    recognition.onend = () => {
      debug("SpeechRecognition calibração: end");
      finalizeErrorSafe();
    };

    const finalizeErrorSafe = () => {
      finalizar().catch(() => {
        resolve(textoFinal.trim());
      });
    };

    const iniciarMonitorSilencio = async () => {
      try {
        monitorStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
          debug("AudioContext indisponível para monitor de silêncio da calibração.");
          return;
        }
        audioContext = new AudioContextCtor();
        monitorSource = audioContext.createMediaStreamSource(monitorStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        monitorSource.connect(analyser);
      } catch (error) {
        debug(`Monitor de silêncio da calibração indisponível: ${error.message || String(error)}`);
        return;
      }

      monitorTimer = window.setInterval(() => {
        if (!analyser || finalizado) {
          return;
        }
        analyser.getFloatTimeDomainData(amostra);
        let soma = 0;
        for (let i = 0; i < amostra.length; i += 1) {
          soma += amostra[i] * amostra[i];
        }
        const rms = Math.sqrt(soma / amostra.length);
        const agora = performance.now();
        if (rms >= CALIBRACAO_VOICE_RMS_MIN) {
          hasVoice = true;
          ultimoSomMs = agora;
          return;
        }
        if (hasVoice && ultimoSomMs && agora - ultimoSomMs >= CALIBRACAO_SILENCIO_STOP_MS) {
          debug("SpeechRecognition calibração: stop por silêncio contínuo.");
          try {
            recognition.stop();
          } catch (error) {
            debug(`Falha no stop por silêncio da calibração: ${error.message || String(error)}`);
          }
        }
      }, 120);
    };

    try {
      recognition.start();
      debug("SpeechRecognition calibração: start");
      iniciarMonitorSilencio();
    } catch (error) {
      debug(`Falha ao iniciar SpeechRecognition na calibração: ${error.message || String(error)}`);
      setStatus("Status: falha ao iniciar reconhecimento de voz da calibração.");
      finalizeErrorSafe();
      return;
    }

    timeoutStopTimer = window.setTimeout(() => {
      try {
        recognition.stop();
      } catch (error) {
        debug(`Falha ao parar SpeechRecognition na calibração: ${error.message || String(error)}`);
        finalizeErrorSafe();
      }
      window.setTimeout(() => {
        finalizeErrorSafe();
      }, 350);
    }, duracaoMs);
  });
}

function capturarTranscricaoCalibracao(duracaoMs, opcoes = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    debug("Web Speech API indisponivel para extrair nome na calibracao.");
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    const recognition = new SpeechRecognition();
    const track = opcoes.track || null;
    let textoFinal = "";
    let textoInterim = "";
    let finalizado = false;
    let timeoutStopTimer = null;

    const finalizar = () => {
      if (finalizado) {
        return;
      }
      finalizado = true;
      if (timeoutStopTimer) {
        window.clearTimeout(timeoutStopTimer);
        timeoutStopTimer = null;
      }
      resolve(`${textoFinal} ${textoInterim}`.trim());
    };

    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const resultado = event.results[i];
        const texto = (resultado[0] && resultado[0].transcript ? resultado[0].transcript : "").trim();
        if (!texto) {
          continue;
        }
        if (resultado.isFinal) {
          textoFinal = `${textoFinal} ${texto}`.trim();
          textoInterim = "";
        } else {
          textoInterim = texto;
        }
      }
    };

    recognition.onerror = (event) => {
      const erro = event && event.error ? event.error : "desconhecido";
      debug(`SpeechRecognition calibracao erro: ${erro}`);
      setStatus(`Status: erro na calibracao por voz: ${erro}`);
      finalizar();
    };

    recognition.onend = () => {
      debug("SpeechRecognition calibracao: end");
      finalizar();
    };

    const iniciarRecognition = () => {
      try {
        if (track) {
          try {
            recognition.start(track);
            debug("SpeechRecognition calibracao: start(track)");
            return true;
          } catch (errorTrack) {
            debug(`SpeechRecognition calibracao: start(track) indisponivel, fallback start(). Motivo: ${errorTrack.message || String(errorTrack)}`);
          }
        }
        recognition.start();
        debug("SpeechRecognition calibracao: start");
        return true;
      } catch (error) {
        debug(`Falha ao iniciar SpeechRecognition na calibracao: ${error.message || String(error)}`);
        setStatus("Status: falha ao iniciar reconhecimento de voz da calibracao.");
        finalizar();
        return false;
      }
    };

    if (!iniciarRecognition()) {
      return;
    }

    timeoutStopTimer = window.setTimeout(() => {
      try {
        recognition.stop();
      } catch (error) {
        debug(`Falha ao parar SpeechRecognition na calibracao: ${error.message || String(error)}`);
        finalizar();
      }
      window.setTimeout(() => {
        finalizar();
      }, 350);
    }, duracaoMs);
  });
}

// Extrai nome próprio de frases como "meu nome é ...".
function extrairNomeDaCalibracao(texto) {
  if (!texto) {
    return "";
  }

  const limpo = texto
    .replace(/[.,!?;:()[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpo) {
    return "";
  }

  const match = limpo.match(
    /(?:meu nome(?:\s+é|\s+e)?|eu sou|me chamo)\s+([\p{L}][\p{L}-]*(?:\s+[\p{L}][\p{L}-]*){0,2})/iu
  );
  if (match && match[1]) {
    return normalizarNome(match[1]);
  }

  const tokens = limpo.split(" ").filter(Boolean);
  if (!tokens.length) {
    return "";
  }
  return normalizarNome(tokens[tokens.length - 1]);
}

// Normaliza capitalização e remove stopwords simples de nomes.
function normalizarNome(nome) {
  const stopwords = new Set(["é", "e", "o", "a", "um", "uma", "de", "da", "do"]);
  const palavras = nome
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p && !stopwords.has(p.toLowerCase()))
    .slice(0, 3);

  return palavras
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ")
    .trim();
}
const EXPERIMENTAL_VARIANT = {
  id: "v2",
  analysisWindowMs: 550
};

Object.assign(state, {
  pendingFinalSegmentsCompat: [],
  pauseRecognitionResolveCompat: null,
  pauseRecognitionTimerCompat: null,
  recognitionPauseReasonCompat: "",
  analysisBusyCompat: false
});

function isMobile() {
  const ua = (navigator.userAgent || navigator.vendor || "").toLowerCase();
  return /android|iphone|ipad|ipod|mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
}

function waitCompat(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function obterAudioConstraintsCompat() {
  return {
    channelCount: 2,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };
}

function resetarSaidaEntrevistaCompat() {
  state.timeline = [];
  state.segmentosMarcados = [];
  state.transcricaoFinalPartes = [];
  state.interimAtual = "";
  state.ultimoInterimUpdateMs = 0;
  state.cortesCandidatos = [];
  state.ultimoLabelInterim = null;
  state.confirmacoesTrocaInterim = 0;
  state.trocaInterimPendente = null;
  state.ultimoCorteConfirmadoMs = 0;
  state.janelaInterimLabels = [];
  state.aguardandoFlushFinal = false;
  state.finalizarRecognitionResolve = null;
  state.pendingFinalSegmentsCompat = [];
  state.analysisBusyCompat = false;
  if (state.finalizarRecognitionTimer) {
    window.clearTimeout(state.finalizarRecognitionTimer);
    state.finalizarRecognitionTimer = null;
  }
  els.resultadoSegmentos.textContent = "";
  atualizarTranscricaoFinalUI();
}

function registrarFrameCompat(feature, opcoes = {}) {
  if (!feature) {
    return;
  }
  const frame = {
    time: Number.isFinite(feature.time) ? feature.time : performance.now(),
    ch: Number.isFinite(feature.ch) ? feature.ch : 0,
    vol: Number.isFinite(feature.vol) ? feature.vol : 0,
    pit: Number.isFinite(feature.pit) ? feature.pit : 0,
    zcr: Number.isFinite(feature.zcr) ? feature.zcr : 0,
    cent: Number.isFinite(feature.cent) ? feature.cent : 0
  };
  state.ultimoFeature = frame;
  state.timeline.push(frame);
  const corte = performance.now() - RETENCAO_TIMELINE_MS;
  while (state.timeline.length && state.timeline[0].time < corte) {
    state.timeline.shift();
  }
  if (state.calibrando || opcoes.paraCalibracao) {
    state.calibracaoBuffer.push(frame);
  }
}

function incorporarFramesNaTimelineCompat(frames, opcoes = {}) {
  if (!Array.isArray(frames) || !frames.length) {
    return;
  }
  const agora = performance.now();
  const base = agora - Math.max(0, (frames.length - 1) * FEATURE_INTERVAL_MS);
  for (let i = 0; i < frames.length; i += 1) {
    const atual = Object.assign({}, frames[i]);
    if (!Number.isFinite(atual.time)) {
      atual.time = base + i * FEATURE_INTERVAL_MS;
    }
    registrarFrameCompat(atual, opcoes);
  }
}

function calcularSpectralCentroidNormalizadoCompat(analyserL, analyserR, freqL, freqR, sampleRate) {
  if (!analyserL || !analyserR || !freqL || !freqR) {
    return 0;
  }
  analyserL.getFloatFrequencyData(freqL);
  analyserR.getFloatFrequencyData(freqR);
  const bins = Math.min(freqL.length, freqR.length);
  if (!bins) {
    return 0;
  }
  const nyquist = sampleRate * 0.5;
  let somaPesos = 0;
  let somaFreq = 0;
  for (let i = 0; i < bins; i += 1) {
    const dbL = Number.isFinite(freqL[i]) ? freqL[i] : -160;
    const dbR = Number.isFinite(freqR[i]) ? freqR[i] : -160;
    const dbMedio = (dbL + dbR) * 0.5;
    const mag = Math.pow(10, dbMedio / 20);
    const hz = (i / Math.max(1, bins - 1)) * nyquist;
    somaPesos += mag;
    somaFreq += hz * mag;
  }
  if (somaPesos <= 0) {
    return 0;
  }
  const centroidHz = somaFreq / somaPesos;
  const normalizado = (centroidHz - CENTROID_MIN_HZ) / (CENTROID_MAX_HZ - CENTROID_MIN_HZ);
  return clamp(normalizado, 0, 1);
}

async function capturarFramesTemporariosCompat(duracaoMs, opcoes = {}) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("AudioContext nao disponivel.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: obterAudioConstraintsCompat()
  });
  const audioContext = new AudioContextCtor();
  const frames = [];
  let timer = null;
  try {
    if (audioContext.state === "suspended") {
      try {
        await audioContext.resume();
      } catch (errorResume) {
        debug(`Aviso ao retomar AudioContext temporario: ${errorResume.message || String(errorResume)}`);
      }
    }
    const source = audioContext.createMediaStreamSource(stream);
    const splitter = audioContext.createChannelSplitter(2);
    const analyserL = audioContext.createAnalyser();
    const analyserR = audioContext.createAnalyser();
    analyserL.fftSize = 2048;
    analyserR.fftSize = 2048;
    analyserL.smoothingTimeConstant = 0.2;
    analyserR.smoothingTimeConstant = 0.2;
    source.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    const floatL = new Float32Array(analyserL.fftSize);
    const floatR = new Float32Array(analyserR.fftSize);
    const freqL = new Float32Array(analyserL.frequencyBinCount);
    const freqR = new Float32Array(analyserR.frequencyBinCount);

    await new Promise((resolve) => {
      timer = window.setInterval(() => {
        analyserL.getFloatTimeDomainData(floatL);
        analyserR.getFloatTimeDomainData(floatR);
        const rmsL = rms(floatL);
        const rmsR = rms(floatR);
        const mix = criarSinalMixado(floatL, floatR);
        frames.push({
          time: performance.now(),
          ch: clamp((rmsL - rmsR) / (rmsL + rmsR + 1e-6), -1, 1),
          vol: clamp((rmsL + rmsR) * 0.5, 0, 1),
          pit: detectarPitchNormalizado(mix, audioContext.sampleRate),
          zcr: calcularZeroCrossingRate(mix),
          cent: calcularSpectralCentroidNormalizadoCompat(
            analyserL,
            analyserR,
            freqL,
            freqR,
            audioContext.sampleRate
          )
        });
      }, FEATURE_INTERVAL_MS);
      window.setTimeout(resolve, duracaoMs);
    });
  } finally {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch (e) {
      // noop
    }
    try {
      await audioContext.close();
    } catch (e) {
      // noop
    }
  }
  if (opcoes.logLabel) {
    debug(`${opcoes.logLabel}: ${frames.length} frames temporarios coletados.`);
  }
  return frames;
}

async function pararRecognitionSemFlushCompat(motivo = "manual") {
  if (!state.recognition || !state.recognitionRunning) {
    return;
  }
  state.recognitionPauseReasonCompat = motivo;
  await new Promise((resolve) => {
    let resolvido = false;
    const concluir = () => {
      if (resolvido) {
        return;
      }
      resolvido = true;
      if (state.pauseRecognitionTimerCompat) {
        window.clearTimeout(state.pauseRecognitionTimerCompat);
        state.pauseRecognitionTimerCompat = null;
      }
      state.pauseRecognitionResolveCompat = null;
      resolve();
    };
    state.pauseRecognitionResolveCompat = concluir;
    state.pauseRecognitionTimerCompat = window.setTimeout(concluir, 1200);
    try {
      state.recognition.stop();
    } catch (error) {
      debug(`Aviso ao parar recognition de forma controlada: ${error.message || String(error)}`);
      concluir();
    }
  });
}

function esvaziarPendenciasComoIndefinidoCompat() {
  while (state.pendingFinalSegmentsCompat.length) {
    const item = state.pendingFinalSegmentsCompat.shift();
    if (item && textoTemConteudo(item.texto)) {
      marcarSegmentoIndefinido(item.texto);
    }
  }
}

function processarPendenciasCompat() {
  while (state.pendingFinalSegmentsCompat.length) {
    const item = state.pendingFinalSegmentsCompat.shift();
    if (!item || !textoTemConteudo(item.texto)) {
      continue;
    }
    try {
      fecharSegmento(item.texto);
    } catch (error) {
      debug(`Falha ao fechar segmento pendente: ${error.message || String(error)}`);
      marcarSegmentoIndefinido(item.texto);
    }
  }
}

async function executarAnaliseDominanteCompat() {
  if (!isMobile() || !state.entrevistaAtiva || state.analysisBusyCompat || !state.pendingFinalSegmentsCompat.length) {
    return;
  }
  state.analysisBusyCompat = true;
  try {
    await pararRecognitionSemFlushCompat("analysis");
    const frames = await capturarFramesTemporariosCompat(EXPERIMENTAL_VARIANT.analysisWindowMs, {
      logLabel: "Analise dominante"
    });
    incorporarFramesNaTimelineCompat(frames);
    processarPendenciasCompat();
  } catch (error) {
    debug(`Analise dominante falhou: ${error.message || String(error)}`);
    esvaziarPendenciasComoIndefinidoCompat();
  } finally {
    state.analysisBusyCompat = false;
    if (state.entrevistaAtiva) {
      try {
        iniciarRecognition();
      } catch (errorRestart) {
        setStatus("Status: falha ao retomar reconhecimento apos analise mobile.");
        debug(`Falha ao retomar recognition apos analise: ${errorRestart.message || String(errorRestart)}`);
      }
    }
  }
}

function processarResultadoFinalCompat(textoBruto) {
  const texto = (textoBruto || "").trim();
  if (!texto) {
    return;
  }
  if (isMobile() && state.entrevistaAtiva) {
    state.pendingFinalSegmentsCompat.push({
      texto,
      textoBruto: textoBruto || "",
      criadoEm: performance.now()
    });
    debug(`trecho final pendente para analise dominante mobile: ${texto}`);
    window.setTimeout(() => {
      executarAnaliseDominanteCompat().catch((error) => {
        debug(`Analise dominante assincrona falhou: ${error.message || String(error)}`);
      });
    }, 0);
  } else {
    try {
      fecharSegmento(texto);
    } catch (error) {
      debug(`falha na marcacao do segmento final, aplicando fallback '??': ${error.message || String(error)}`);
      marcarSegmentoIndefinido(texto);
    }
  }
  adicionarTrechoConsolidado(prepararTextoTranscricaoFinal(textoBruto), "final");
  state.interimAtual = "";
  debug(`trecho final consolidado: ${texto}`);
  atualizarTranscricaoFinalUI();
}

function iniciarRecognition(opcoes = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error("Web Speech API nao disponivel no navegador.");
  }
  const track = opcoes.track || null;
  const disableAutoRestart = !!opcoes.disableAutoRestart;
  const allowTrackFallback = opcoes.allowTrackFallback !== false;

  if (state.recognition) {
    try {
      state.recognition.onresult = null;
      state.recognition.onerror = null;
      state.recognition.onend = null;
      state.recognition.stop();
    } catch (e) {
      debug(`Aviso ao reiniciar recognition: ${e.message || String(e)}`);
    }
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "pt-BR";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const resultado = event.results[i];
      const textoBruto = resultado[0] && resultado[0].transcript ? resultado[0].transcript : "";
      const texto = textoBruto.trim();
      if (!texto) {
        continue;
      }
      if (resultado.isFinal) {
        try {
          limparCortesCandidatosAntigos(performance.now());
          processarResultadoFinalCompat(textoBruto);
        } catch (errorFinal) {
          debug(`erro inesperado no processamento final: ${errorFinal.message || String(errorFinal)}`);
          marcarSegmentoIndefinido(texto);
        }
      } else {
        const textoInterim = prepararTextoTranscricaoFinal(textoBruto);
        if (state.interimAtual !== textoInterim) {
          state.interimAtual = textoInterim;
          state.ultimoInterimUpdateMs = Date.now();
          avaliarCorteDuranteInterim(textoInterim);
          debug(`interim atualizado (analise de corte, sem consolidacao): ${texto}`);
          atualizarTranscricaoFinalUI();
        }
      }
    }
  };

  recognition.onerror = (event) => {
    const erro = event.error || "desconhecido";
    setStatus(`Status: erro no reconhecimento de fala: ${erro}`);
    debug(`SpeechRecognition entrevista erro: ${erro}`);
  };

  recognition.onend = () => {
    debug("SpeechRecognition entrevista: end");
    state.recognitionRunning = false;

    const pauseResolver = state.pauseRecognitionResolveCompat;
    const pauseReason = state.recognitionPauseReasonCompat;
    state.pauseRecognitionResolveCompat = null;
    state.recognitionPauseReasonCompat = "";
    if (state.pauseRecognitionTimerCompat) {
      window.clearTimeout(state.pauseRecognitionTimerCompat);
      state.pauseRecognitionTimerCompat = null;
    }
    if (pauseResolver) {
      pauseResolver();
    }

    if (state.aguardandoFlushFinal && state.finalizarRecognitionResolve) {
      const resolve = state.finalizarRecognitionResolve;
      state.finalizarRecognitionResolve = null;
      if (state.finalizarRecognitionTimer) {
        window.clearTimeout(state.finalizarRecognitionTimer);
        state.finalizarRecognitionTimer = null;
      }
      state.aguardandoFlushFinal = false;
      resolve();
      return;
    }

    if (!state.entrevistaAtiva || disableAutoRestart || pauseReason) {
      return;
    }

    try {
      iniciarRecognitionInternoCompat(recognition, track, "restart", allowTrackFallback);
      state.recognitionRunning = true;
      debug("SpeechRecognition entrevista: restart");
    } catch (errorRestart) {
      setStatus("Status: falha ao reiniciar reconhecimento de fala da entrevista.");
      debug(`Falha ao reiniciar recognition: ${errorRestart.message || String(errorRestart)}`);
    }
  };

  try {
    iniciarRecognitionInternoCompat(recognition, track, "start", allowTrackFallback);
    state.recognition = recognition;
    state.recognitionRunning = true;
  } catch (error) {
    setStatus("Status: nao foi possivel iniciar reconhecimento de fala.");
    debug(`Falha ao iniciar SpeechRecognition da entrevista: ${error.message || String(error)}`);
    throw error;
  }
}

function iniciarRecognitionInternoCompat(recognition, track, contexto, allowTrackFallback) {
  if (track) {
    try {
      recognition.start(track);
      debug(`SpeechRecognition entrevista: ${contexto}(track)`);
      return;
    } catch (errorTrack) {
      debug(`SpeechRecognition entrevista: ${contexto}(track) indisponivel. Motivo: ${errorTrack.message || String(errorTrack)}`);
      if (!allowTrackFallback) {
        throw errorTrack;
      }
    }
  }
  recognition.start();
  debug(`SpeechRecognition entrevista: ${contexto}`);
}

function capturarTranscricaoCalibracao(duracaoMs, opcoes = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    debug("Web Speech API indisponivel para extrair nome na calibracao.");
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    const recognition = new SpeechRecognition();
    const track = !isMobile() ? (opcoes.track || null) : null;
    let textoFinal = "";
    let textoInterim = "";
    let finalizado = false;
    let timeoutStopTimer = null;

    const finalizar = () => {
      if (finalizado) {
        return;
      }
      finalizado = true;
      if (timeoutStopTimer) {
        window.clearTimeout(timeoutStopTimer);
        timeoutStopTimer = null;
      }
      resolve(`${textoFinal} ${textoInterim}`.trim());
    };

    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const resultado = event.results[i];
        const texto = (resultado[0] && resultado[0].transcript ? resultado[0].transcript : "").trim();
        if (!texto) {
          continue;
        }
        if (resultado.isFinal) {
          textoFinal = `${textoFinal} ${texto}`.trim();
          textoInterim = "";
        } else {
          textoInterim = texto;
        }
      }
    };

    recognition.onerror = (event) => {
      const erro = event && event.error ? event.error : "desconhecido";
      debug(`SpeechRecognition calibracao erro: ${erro}`);
      setStatus(`Status: erro na calibracao por voz: ${erro}`);
      finalizar();
    };

    recognition.onend = () => {
      debug("SpeechRecognition calibracao: end");
      finalizar();
    };

    try {
      if (track) {
        try {
          recognition.start(track);
          debug("SpeechRecognition calibracao: start(track)");
        } catch (errorTrack) {
          debug(`SpeechRecognition calibracao: start(track) indisponivel, fallback start(). Motivo: ${errorTrack.message || String(errorTrack)}`);
          recognition.start();
          debug("SpeechRecognition calibracao: start");
        }
      } else {
        recognition.start();
        debug("SpeechRecognition calibracao: start");
      }
    } catch (error) {
      debug(`Falha ao iniciar SpeechRecognition na calibracao: ${error.message || String(error)}`);
      setStatus("Status: falha ao iniciar reconhecimento de voz da calibracao.");
      finalizar();
      return;
    }

    timeoutStopTimer = window.setTimeout(() => {
      try {
        recognition.stop();
      } catch (error) {
        debug(`Falha ao parar SpeechRecognition na calibracao: ${error.message || String(error)}`);
        finalizar();
      }
      window.setTimeout(finalizar, 350);
    }, duracaoMs);
  });
}

async function calibrar(nome) {
  let audioCalibracaoAtivo = false;
  let calibracaoConcluida = false;
  let sessaoCompartilhada = null;
  let textoCalibracao = "";
  let nomeExtraido = "";
  try {
    if (state.entrevistaAtiva) {
      setStatus("Status: finalize a entrevista antes de calibrar.");
      return;
    }
    if (state.calibrando) {
      setStatus("Status: ja existe calibracao em andamento.");
      return;
    }

    travarControles(true);
    debug(`Calibracao de ${nome} iniciada.`);
    state.calibrando = nome;
    state.calibracaoBuffer = [];

    if (isMobile()) {
      setStatus(`Status: capturando nome de ${nome} no modo mobile seguro...`);
      textoCalibracao = await capturarTranscricaoCalibracao(CALIBRACAO_MS);
      nomeExtraido = extrairNomeDaCalibracao(textoCalibracao);
      if (!nomeExtraido) {
        setStatus("Status: nome nao identificado na calibracao; usando rotulo padrao.");
        debug("Nome nao identificado na calibracao; usando rotulo padrao.");
      }
      setStatus(`Status: coletando assinatura acustica de ${nome} em janela separada...`);
      const framesBrutos = await capturarFramesTemporariosCompat(CALIBRACAO_MS, {
        logLabel: `Calibracao mobile ${nome}`
      });
      incorporarFramesNaTimelineCompat(framesBrutos, { paraCalibracao: true });
      const diagnosticoFrames = classificarFramesCalibracao(framesBrutos.slice());
      const framesVoz = diagnosticoFrames.validos;
      if (framesVoz.length < CALIBRACAO_MIN_FRAMES_VOZ) {
        setStatus("Status: poucos frames de voz na calibracao. Tente novamente falando mais perto e de forma continua.");
        diagnosticarFalhaCalibracao(nome, framesBrutos, diagnosticoFrames);
        return;
      }
      const assinatura = mediaEdesvioFeatures(framesVoz);
      if (!assinatura) {
        setStatus(`Status: falha na calibracao de ${nome}. Tente novamente.`);
        debug(`Calibracao de ${nome} sem dados suficientes.`);
        return;
      }
      if (nome === "Individuo 1") {
        state.assinaturaIndividuo1 = assinatura;
        state.nomeIndividuo1 = nomeExtraido || "Individuo 1";
      } else {
        state.assinaturaIndividuo2 = assinatura;
        state.nomeIndividuo2 = nomeExtraido || "Individuo 2";
      }
      const rotuloAtual = nome === "Individuo 1" ? state.nomeIndividuo1 : state.nomeIndividuo2;
      setStatus(`Status: calibracao de ${nome} concluida (${rotuloAtual}).`);
      debug(`Fala calibracao ${nome}: "${textoCalibracao || "sem transcricao"}"`);
      debug(`Frames calibracao ${nome}: brutos=${framesBrutos.length}, voz=${framesVoz.length}, usados=${framesVoz.length}`);
      debug(`Assinatura ${rotuloAtual} medias: ${formatFeatures(assinatura.medias)}`);
      debug(`Assinatura ${rotuloAtual} desvios: ${formatFeatures(assinatura.desvios)}`);
      atualizarPesosAposCalibracao();
      calibracaoConcluida = true;
      return;
    }

    setStatus(`Status: capturando nome e assinatura acustica do ${nome}...`);
    sessaoCompartilhada = await criarSessaoAudioCompartilhada();
    debug("Calibracao: stream compartilhado criado (raw + clones para analise/STT).");
    const promessaTranscricao = capturarTranscricaoCalibracao(CALIBRACAO_MS, {
      track: sessaoCompartilhada.sttTrack
    });
    await setupAudioEngine({
      forCalibration: true,
      stream: sessaoCompartilhada.analysisStream
    });
    audioCalibracaoAtivo = true;
    await waitCompat(CALIBRACAO_MS);
    textoCalibracao = await promessaTranscricao;
    nomeExtraido = extrairNomeDaCalibracao(textoCalibracao);
    if (!nomeExtraido) {
      setStatus("Status: nome nao identificado na calibracao; usando rotulo padrao.");
      debug("Nome nao identificado na calibracao; usando rotulo padrao.");
    }

    const framesBrutos = state.calibracaoBuffer.slice();
    const diagnosticoFrames = classificarFramesCalibracao(framesBrutos);
    const framesVoz = diagnosticoFrames.validos;
    if (framesVoz.length < CALIBRACAO_MIN_FRAMES_VOZ) {
      setStatus("Status: poucos frames de voz na calibracao. Tente novamente falando mais perto e de forma continua.");
      diagnosticarFalhaCalibracao(nome, framesBrutos, diagnosticoFrames);
      return;
    }
    const assinatura = mediaEdesvioFeatures(framesVoz);
    if (!assinatura) {
      setStatus(`Status: falha na calibracao de ${nome}. Tente novamente.`);
      debug(`Calibracao de ${nome} sem dados suficientes.`);
      return;
    }

    if (nome === "Individuo 1") {
      state.assinaturaIndividuo1 = assinatura;
      state.nomeIndividuo1 = nomeExtraido || "Individuo 1";
    } else {
      state.assinaturaIndividuo2 = assinatura;
      state.nomeIndividuo2 = nomeExtraido || "Individuo 2";
    }

    const rotuloAtual = nome === "Individuo 1" ? state.nomeIndividuo1 : state.nomeIndividuo2;
    setStatus(`Status: calibracao de ${nome} concluida (${rotuloAtual}).`);
    debug(`Fala calibracao ${nome}: "${textoCalibracao || "sem transcricao"}"`);
    debug(`Frames calibracao ${nome}: brutos=${framesBrutos.length}, voz=${framesVoz.length}, usados=${framesVoz.length}`);
    debug(`Assinatura ${rotuloAtual} medias: ${formatFeatures(assinatura.medias)}`);
    debug(`Assinatura ${rotuloAtual} desvios: ${formatFeatures(assinatura.desvios)}`);
    atualizarPesosAposCalibracao();
    calibracaoConcluida = true;
  } catch (error) {
    setStatus("Status: erro ao executar calibracao.");
    debug(`Erro de calibracao: ${error.message || String(error)}`);
  } finally {
    if (audioCalibracaoAtivo) {
      await teardownAudioEngine();
      debug(
        calibracaoConcluida
          ? "Recursos de audio da calibracao liberados."
          : "Recursos de audio da calibracao liberados apos falha."
      );
    }
    if (sessaoCompartilhada) {
      try {
        sessaoCompartilhada.cleanup();
        debug("Calibracao: stream compartilhado encerrado.");
      } catch (e) {
        debug(`Aviso ao encerrar stream compartilhado: ${e.message || String(e)}`);
      }
    }
    state.calibrando = null;
    state.calibracaoBuffer = [];
    travarControles(false);
    atualizarEstadoControles();
    debug(
      calibracaoConcluida
        ? "Calibracao concluida e estado resetado."
        : "Calibracao abortada e estado resetado."
    );
  }
}

async function iniciarEntrevistaCompartilhadaCompat() {
  let sessaoEntrevista = null;
  try {
    sessaoEntrevista = await criarSessaoAudioCompartilhada();
    state.sessaoEntrevista = sessaoEntrevista;
    debug("Entrevista: stream compartilhado criado (raw + clones para analise/STT).");
    await setupAudioEngine({
      stream: sessaoEntrevista.analysisStream
    });
    resetarSaidaEntrevistaCompat();
    iniciarRecognition({
      track: sessaoEntrevista.sttTrack
    });
    state.entrevistaAtiva = true;
    atualizarEstadoControles();
    setStatus("Status: entrevista ativa (captura + transcricao continua).");
    debug("Entrevista iniciada.");
  } catch (error) {
    if (sessaoEntrevista) {
      try {
        sessaoEntrevista.cleanup();
      } catch (e) {
        debug(`Aviso ao encerrar stream compartilhado da entrevista: ${e.message || String(e)}`);
      }
    }
    state.sessaoEntrevista = null;
    setStatus("Status: nao foi possivel iniciar a entrevista.");
    debug(`Erro ao iniciar entrevista: ${error.message || String(error)}`);
  }
}

async function iniciarEntrevista() {
  if (state.entrevistaAtiva) {
    return;
  }
  if (!state.assinaturaIndividuo1 || !state.assinaturaIndividuo2) {
    setStatus("Status: calibre Individuo 1 e Individuo 2 antes de iniciar.");
    return;
  }

  if (!isMobile()) {
    await iniciarEntrevistaCompartilhadaCompat();
    return;
  }

  resetarSaidaEntrevistaCompat();
  state.entrevistaAtiva = true;
  atualizarEstadoControles();
  setStatus("Status: entrevista ativa com recognition dominante no mobile.");
  try {
    iniciarRecognition();
    debug("Entrevista mobile dominante iniciada.");
  } catch (errorStart) {
    state.entrevistaAtiva = false;
    atualizarEstadoControles();
    setStatus("Status: nao foi possivel iniciar recognition no mobile.");
    debug(`Falha ao iniciar recognition dominante: ${errorStart.message || String(errorStart)}`);
  }
}

async function finalizarEntrevista() {
  if (!state.entrevistaAtiva) {
    return;
  }

  state.entrevistaAtiva = false;
  atualizarEstadoControles();

  if (isMobile()) {
    await pararRecognitionSemFlushCompat("finalizar");
    if (state.pendingFinalSegmentsCompat.length) {
      try {
        const frames = await capturarFramesTemporariosCompat(EXPERIMENTAL_VARIANT.analysisWindowMs, {
          logLabel: "Analise final de encerramento"
        });
        incorporarFramesNaTimelineCompat(frames);
        processarPendenciasCompat();
      } catch (errorFinal) {
        debug(`Falha na analise final antes de encerrar: ${errorFinal.message || String(errorFinal)}`);
        esvaziarPendenciasComoIndefinidoCompat();
      }
    }
  } else {
    await aguardarParadaRecognition();
  }

  flushInterimFinalSeNecessario();

  if (state.audioContext || state.stream) {
    await teardownAudioEngine();
  }
  if (state.sessaoEntrevista) {
    try {
      state.sessaoEntrevista.cleanup();
      debug("Entrevista: stream compartilhado encerrado.");
    } catch (e) {
      debug(`Aviso ao encerrar stream compartilhado da entrevista: ${e.message || String(e)}`);
    }
  }
  state.sessaoEntrevista = null;
  state.recognitionRunning = false;
  state.pendingFinalSegmentsCompat = [];
  state.analysisBusyCompat = false;
  atualizarEstadoControles();
  setStatus("Status: entrevista finalizada.");
  debug("Entrevista finalizada e recursos liberados.");
}
Object.assign(state, {
  featureEngineCleanupV4: null,
  featureWorkerV4: null,
  workletNodeV4: null,
  scriptProcessorV4: null,
  silentGainV4: null,
  featureModuleUrlV4: null,
  featureWorkerUrlV4: null
});

function registrarFrameIsoladoV4(feature, opcoes = {}) {
  if (!feature) {
    return;
  }
  const frame = {
    time: Number.isFinite(feature.time) ? feature.time : performance.now(),
    ch: Number.isFinite(feature.ch) ? feature.ch : 0,
    vol: Number.isFinite(feature.vol) ? feature.vol : 0,
    pit: Number.isFinite(feature.pit) ? feature.pit : 0,
    zcr: Number.isFinite(feature.zcr) ? feature.zcr : 0,
    cent: Number.isFinite(feature.cent) ? feature.cent : 0
  };
  state.ultimoFeature = frame;
  state.timeline.push(frame);
  const corte = performance.now() - RETENCAO_TIMELINE_MS;
  while (state.timeline.length && state.timeline[0].time < corte) {
    state.timeline.shift();
  }
  if (state.calibrando || opcoes.paraCalibracao) {
    state.calibracaoBuffer.push(frame);
  }
}

function featureAlgorithmSourceV4() {
  return `
    const FEATURE_INTERVAL_MS = 50;
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
    function rms(buffer) {
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        sum += buffer[i] * buffer[i];
      }
      return Math.sqrt(sum / Math.max(1, buffer.length));
    }
    function mixBuffers(left, right) {
      const mix = new Float32Array(left.length);
      for (let i = 0; i < left.length; i += 1) {
        mix[i] = (left[i] + right[i]) * 0.5;
      }
      return mix;
    }
    function zeroCrossingRate(buffer) {
      if (!buffer || buffer.length < 2) {
        return 0;
      }
      let count = 0;
      for (let i = 1; i < buffer.length; i += 1) {
        const a = buffer[i - 1];
        const b = buffer[i];
        if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
          count += 1;
        }
      }
      return clamp(count / (buffer.length - 1), 0, 1);
    }
    function autoCorrelacaoPitch(buffer, sampleRate) {
      const tamanho = buffer.length;
      let energia = 0;
      for (let i = 0; i < tamanho; i += 1) {
        energia += buffer[i] * buffer[i];
      }
      energia = Math.sqrt(energia / Math.max(1, tamanho));
      if (energia < 0.01) {
        return 0;
      }
      let melhorLag = -1;
      let melhorCorr = 0;
      const minLag = Math.floor(sampleRate / 350);
      const maxLag = Math.floor(sampleRate / 80);
      for (let lag = minLag; lag <= maxLag; lag += 1) {
        let corr = 0;
        for (let i = 0; i < tamanho - lag; i += 1) {
          corr += buffer[i] * buffer[i + lag];
        }
        corr /= Math.max(1, tamanho - lag);
        if (corr > melhorCorr) {
          melhorCorr = corr;
          melhorLag = lag;
        }
      }
      return melhorLag > 0 ? sampleRate / melhorLag : 0;
    }
    function normalizarPitch(buffer, sampleRate) {
      const freq = autoCorrelacaoPitch(buffer, sampleRate);
      if (!freq) {
        return 0;
      }
      return clamp((freq - 80) / (350 - 80), 0, 1);
    }
    function spectralCentroidNorm(buffer, sampleRate) {
      const size = Math.min(256, buffer.length);
      if (size < 32) {
        return 0;
      }
      const step = Math.max(1, Math.floor(buffer.length / size));
      const temp = new Float32Array(size);
      for (let i = 0; i < size; i += 1) {
        temp[i] = buffer[Math.min(buffer.length - 1, i * step)];
      }
      let sumMag = 0;
      let sumFreq = 0;
      const nyquist = sampleRate * 0.5;
      for (let k = 0; k < size / 2; k += 1) {
        let real = 0;
        let imag = 0;
        for (let n = 0; n < size; n += 1) {
          const angle = (2 * Math.PI * k * n) / size;
          real += temp[n] * Math.cos(angle);
          imag -= temp[n] * Math.sin(angle);
        }
        const mag = Math.sqrt(real * real + imag * imag);
        const hz = (k / Math.max(1, (size / 2) - 1)) * nyquist;
        sumMag += mag;
        sumFreq += hz * mag;
      }
      if (sumMag <= 0) {
        return 0;
      }
      const centroid = sumFreq / sumMag;
      return clamp((centroid - 80) / (4000 - 80), 0, 1);
    }
    function computeFeatures(left, right, sampleRate) {
      const rmsL = rms(left);
      const rmsR = rms(right);
      const mix = mixBuffers(left, right);
      return {
        ch: clamp((rmsL - rmsR) / (rmsL + rmsR + 1e-6), -1, 1),
        vol: clamp((rmsL + rmsR) * 0.5, 0, 1),
        pit: normalizarPitch(mix, sampleRate),
        zcr: zeroCrossingRate(mix),
        cent: spectralCentroidNorm(mix, sampleRate)
      };
    }
  `;
}

function featureWorkletSourceV4() {
  return `${featureAlgorithmSourceV4()}
    class FeatureProcessorV4 extends AudioWorkletProcessor {
      constructor() {
        super();
        this.leftBuffer = [];
        this.rightBuffer = [];
        this.pendingSamples = 0;
        this.intervalSamples = Math.max(128, Math.floor(sampleRate * FEATURE_INTERVAL_MS / 1000));
      }
      mergeRecent(size, chunks) {
        const out = new Float32Array(size);
        let offset = size;
        for (let i = chunks.length - 1; i >= 0 && offset > 0; i -= 1) {
          const chunk = chunks[i];
          const take = Math.min(offset, chunk.length);
          offset -= take;
          out.set(chunk.subarray(chunk.length - take), offset);
        }
        return out;
      }
      trim(chunks, maxSamples) {
        let total = 0;
        for (let i = chunks.length - 1; i >= 0; i -= 1) {
          total += chunks[i].length;
          if (total > maxSamples) {
            chunks.splice(0, i);
            break;
          }
        }
      }
      process(inputs) {
        const input = inputs[0];
        if (!input || !input[0] || !input[0].length) {
          return true;
        }
        const left = input[0];
        const right = input[1] || input[0];
        this.leftBuffer.push(new Float32Array(left));
        this.rightBuffer.push(new Float32Array(right));
        this.trim(this.leftBuffer, 4096);
        this.trim(this.rightBuffer, 4096);
        this.pendingSamples += left.length;
        if (this.pendingSamples >= this.intervalSamples) {
          this.pendingSamples = 0;
          const frameL = this.mergeRecent(2048, this.leftBuffer);
          const frameR = this.mergeRecent(2048, this.rightBuffer);
          this.port.postMessage(computeFeatures(frameL, frameR, sampleRate));
        }
        return true;
      }
    }
    registerProcessor('feature-processor-v4', FeatureProcessorV4);
  `;
}

function featureWorkerSourceV4() {
  return `${featureAlgorithmSourceV4()}
    self.onmessage = (event) => {
      const payload = event.data || {};
      const left = new Float32Array(payload.left || []);
      const right = new Float32Array(payload.right || payload.left || []);
      const sampleRate = payload.sampleRate || 48000;
      self.postMessage(computeFeatures(left, right, sampleRate));
    };
  `;
}

async function createFeatureEngineV4(stream, onFeature) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("AudioContext nao disponivel.");
  }
  const audioContext = new AudioContextCtor();
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (errorResume) {
      debug(`Aviso ao retomar AudioContext isolado: ${errorResume.message || String(errorResume)}`);
    }
  }
  const source = audioContext.createMediaStreamSource(stream);
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  let workletNode = null;
  let worker = null;
  let scriptProcessor = null;
  let moduleUrl = null;
  let workerUrl = null;

  try {
    if (audioContext.audioWorklet && window.AudioWorkletNode) {
      moduleUrl = URL.createObjectURL(new Blob([featureWorkletSourceV4()], { type: "text/javascript" }));
      await audioContext.audioWorklet.addModule(moduleUrl);
      workletNode = new AudioWorkletNode(audioContext, "feature-processor-v4");
      workletNode.port.onmessage = (event) => {
        onFeature(Object.assign({ time: performance.now() }, event.data || {}));
      };
      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);
    } else {
      workerUrl = URL.createObjectURL(new Blob([featureWorkerSourceV4()], { type: "text/javascript" }));
      worker = new Worker(workerUrl);
      worker.onmessage = (event) => {
        onFeature(Object.assign({ time: performance.now() }, event.data || {}));
      };
      scriptProcessor = audioContext.createScriptProcessor(2048, 2, 1);
      scriptProcessor.onaudioprocess = (event) => {
        const input = event.inputBuffer;
        const left = input.getChannelData(0);
        const right = input.numberOfChannels > 1 ? input.getChannelData(1) : left;
        worker.postMessage({
          left: Array.from(left),
          right: Array.from(right),
          sampleRate: audioContext.sampleRate
        });
      };
      source.connect(scriptProcessor);
      scriptProcessor.connect(silentGain);
      silentGain.connect(audioContext.destination);
    }
  } catch (error) {
    try {
      await audioContext.close();
    } catch (closeError) {
      // noop
    }
    if (moduleUrl) {
      URL.revokeObjectURL(moduleUrl);
    }
    if (workerUrl) {
      URL.revokeObjectURL(workerUrl);
    }
    throw error;
  }

  return {
    audioContext,
    source,
    silentGain,
    workletNode,
    worker,
    scriptProcessor,
    moduleUrl,
    workerUrl,
    cleanup: async () => {
      try {
        if (workletNode) {
          workletNode.disconnect();
        }
      } catch (e) {
        // noop
      }
      try {
        if (scriptProcessor) {
          scriptProcessor.disconnect();
        }
      } catch (e) {
        // noop
      }
      try {
        if (silentGain) {
          silentGain.disconnect();
        }
      } catch (e) {
        // noop
      }
      try {
        if (source) {
          source.disconnect();
        }
      } catch (e) {
        // noop
      }
      if (worker) {
        worker.terminate();
      }
      if (moduleUrl) {
        URL.revokeObjectURL(moduleUrl);
      }
      if (workerUrl) {
        URL.revokeObjectURL(workerUrl);
      }
      try {
        await audioContext.close();
      } catch (e) {
        // noop
      }
    }
  };
}

async function capturarFramesTemporariosCompat(duracaoMs, opcoes = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: obterAudioConstraintsCompat()
  });
  const frames = [];
  let engine = null;
  try {
    engine = await createFeatureEngineV4(stream, (feature) => {
      frames.push(feature);
    });
    await waitCompat(duracaoMs);
  } finally {
    if (engine && engine.cleanup) {
      await engine.cleanup();
    }
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch (e) {
      // noop
    }
  }
  if (opcoes.logLabel) {
    debug(`${opcoes.logLabel}: ${frames.length} frames isolados coletados.`);
  }
  return frames;
}

async function setupAudioEngine(opcoes = {}) {
  if (state.audioContext && state.stream && state.featureTimer) {
    return;
  }
  const forCalibration = !!opcoes.forCalibration;
  let stream = opcoes.stream || null;
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: obterAudioConstraintsCompat()
    });
  }
  const engine = await createFeatureEngineV4(stream, (feature) => {
    registrarFrameIsoladoV4(feature);
  });
  state.audioContext = engine.audioContext;
  state.stream = stream;
  state.source = engine.source;
  state.featureEngineCleanupV4 = engine.cleanup;
  state.workletNodeV4 = engine.workletNode;
  state.featureWorkerV4 = engine.worker;
  state.scriptProcessorV4 = engine.scriptProcessor;
  state.silentGainV4 = engine.silentGain;
  state.featureModuleUrlV4 = engine.moduleUrl;
  state.featureWorkerUrlV4 = engine.workerUrl;
  state.featureTimer = -1;
  state.splitter = null;
  state.analyserL = null;
  state.analyserR = null;
  state.floatL = null;
  state.floatR = null;
  state.freqL = null;
  state.freqR = null;
  debug(forCalibration ? "Calibracao: captura acustica isolada iniciada." : "Captura de audio isolada inicializada.");
}

async function teardownAudioEngine() {
  if (state.featureEngineCleanupV4) {
    try {
      await state.featureEngineCleanupV4();
    } catch (e) {
      debug(`Aviso ao encerrar engine isolado: ${e.message || String(e)}`);
    }
  }
  if (state.stream) {
    try {
      state.stream.getTracks().forEach((track) => track.stop());
    } catch (e) {
      // noop
    }
  }
  state.audioContext = null;
  state.stream = null;
  state.source = null;
  state.splitter = null;
  state.analyserL = null;
  state.analyserR = null;
  state.floatL = null;
  state.floatR = null;
  state.freqL = null;
  state.freqR = null;
  state.featureTimer = null;
  state.featureEngineCleanupV4 = null;
  state.featureWorkerV4 = null;
  state.workletNodeV4 = null;
  state.scriptProcessorV4 = null;
  state.silentGainV4 = null;
  state.featureModuleUrlV4 = null;
  state.featureWorkerUrlV4 = null;
}
