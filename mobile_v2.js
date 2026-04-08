const CALIBRACAO_MS = 4000;
const FEATURE_INTERVAL_MS = 60;
const RETENCAO_TIMELINE_MS = 90000;
const CALIBRACAO_VOL_MIN = 0.012;
const CALIBRACAO_MIN_FRAMES_VOZ = 5;
const VAD_VOL_MIN = 0.012;
const VAD_DYNAMIC_MIN = 0.001;
const VAD_DYNAMIC_MAX = 0.03;
const RECENT_VOLUME_HISTORY_MAX = 160;
const VOLUME_LOG_INTERVAL_MS = 1800;
const SEGMENT_MONITOR_MS = 220;
const SEGMENT_MIN_MS = 3200;
const SEGMENT_MAX_MS = 15000;
const SEGMENT_MAX_SEM_VOZ_MS = 12000;
const SEGMENT_SILENCE_CUT_MS = 1200;
const SEGMENT_AUDIO_OVERLAP_MS = 120;
const AUDIO_PART_PRUNE_MARGIN_MS = 1400;
const RECORDER_TIMESLICE_MS = 500;
const RECORDER_AUDIO_BITS_PER_SECOND = 32000;
const SPEAKER_CONF_MIN_DELTA = 0.09;
const PESO_MINIMO_DINAMICO = 0.03;
const EPSILON_PESO = 1e-6;
const DEBUG_MAX_CHARS = 24000;
const PROMPT_IA_STORAGE_KEY = "entrevista_prompt_ia_personalizado";

const ALL_FEATURE_KEYS = ["vol", "pit", "cent", "zcr", "ch"];
const FEATURE_BASE_IMPORTANCE = {
  vol: 0.34,
  pit: 0.28,
  cent: 0.22,
  zcr: 0.08,
  ch: 0.16
};

const N8N_URL = "https://n8ndovitordalto.duckdns.org/webhook/ia-whisper";
const N8N_BASIC_USER = "entrevista-ia";
const N8N_BASIC_PASS = "pass123!@#";

const PROMPT_PADRAO = `Voce e um assistente de entrevistas. Com base no BLOCO 1 (transcricao corrida) e BLOCO 2 (segmentos marcados), gere um resumo estruturado da entrevista com:
1) contexto geral,
2) principais pontos por interlocutor,
3) riscos e lacunas,
4) proximos passos.

BLOCO 1 - TRANSCRICAO FINAL:
{{TRANSCRICAO_FINAL}}

BLOCO 2 - SEGMENTOS MARCADOS:
{{SEGMENTOS_MARCADOS}}`;

const els = {
  btnCalibrarIndividuo1: document.getElementById("btnCalibrarIndividuo1"),
  btnCalibrarIndividuo2: document.getElementById("btnCalibrarIndividuo2"),
  btnIniciar: document.getElementById("btnIniciar"),
  btnFinalizar: document.getElementById("btnFinalizar"),
  btnModoDebug: document.getElementById("btnModoDebug"),
  btnEnviar: document.getElementById("btnEnviar"),
  btnSalvarPromptIA: document.getElementById("btnSalvarPromptIA"),
  status: document.getElementById("status"),
  debug: document.getElementById("debug"),
  cardDebug: document.getElementById("cardDebug"),
  promptEditor: document.getElementById("promptEditor"),
  campoPromptIA: document.getElementById("campoPromptIA"),
  resultadoGrid: document.getElementById("resultadoGrid"),
  resultadoSegmentos: document.getElementById("resultadoSegmentos"),
  colunaTranscricaoFinal: document.getElementById("colunaTranscricaoFinal"),
  transcricaoFinal: document.getElementById("transcricaoFinal"),
  audioResumo: document.getElementById("audioResumo")
};

const state = {
  modoDebugAtivo: false,
  calibrando: null,
  calibrationBuffer: [],
  calibrationWebhookPending: {
    "Individuo 1": false,
    "Individuo 2": false
  },
  assinaturaIndividuo1: null,
  assinaturaIndividuo2: null,
  nomeIndividuo1: "Individuo 1",
  nomeIndividuo2: "Individuo 2",
  activeFeatureKeys: ["vol", "pit", "cent", "zcr"],
  featureWeights: buildDefaultFeatureWeights(["vol", "pit", "cent", "zcr"]),
  timeline: [],
  ultimoFeature: null,
  audio: createEmptyAudioState(),
  audioInfo: {
    requestedConstraints: null,
    trackSettings: null,
    recordingSettings: null,
    channelCountReal: 0,
    hasRealStereo: false,
    recorderMimeType: "",
    dynamicVoiceThreshold: VAD_VOL_MIN,
    recentVolumes: [],
    lastVolumeLogAtMs: 0
  },
  interview: createEmptyInterviewRuntime(),
  segmentosMarcados: [],
  transcricaoFinalPartes: []
};

boot();

function boot() {
  els.btnCalibrarIndividuo1.addEventListener("click", () => calibrar("Individuo 1"));
  els.btnCalibrarIndividuo2.addEventListener("click", () => calibrar("Individuo 2"));
  els.btnIniciar.addEventListener("click", iniciarEntrevista);
  els.btnFinalizar.addEventListener("click", finalizarEntrevista);
  els.btnModoDebug.addEventListener("click", alternarModoDebug);
  els.btnEnviar.addEventListener("click", enviarParaIA);
  els.btnSalvarPromptIA.addEventListener("click", salvarPromptIA);

  carregarPromptIA();
  updateDebugModeUI();
  updateControls();
  updateAudioSummary();
  setStatus("Status: pronto para calibrar.");
  debug("Sistema mobile v2 iniciado.");
}

function createEmptyAudioState() {
  return {
    rawStream: null,
    recordingStream: null,
    audioContext: null,
    source: null,
    splitter: null,
    analyserL: null,
    analyserR: null,
    monoGainL: null,
    monoGainR: null,
    monoBus: null,
    monitorGain: null,
    monoDestination: null,
    floatL: null,
    floatR: null,
    freqL: null,
    freqR: null,
    avgFreq: null,
    featureTimer: null
  };
}

function createEmptyInterviewRuntime() {
  return {
    active: false,
    finalizing: false,
    closingLogicalSegment: false,
    recorder: null,
    recorderMimeType: "",
    recorderStartMs: 0,
    latestRecordedAudioEndMs: 0,
    audioParts: [],
    audioChunkCount: 0,
    segmentMonitorTimer: null,
    logicalSegmentStartMs: 0,
    logicalSegmentHadVoice: false,
    logicalSegmentLastVoiceAtMs: 0,
    pendingWeakSegment: null,
    uploadQueue: Promise.resolve(),
    segmentCounter: 0
  };
}

function resetInterviewRuntime() {
  state.interview = createEmptyInterviewRuntime();
}

function setStatus(texto) {
  els.status.textContent = texto;
}

function debug(texto, dados = null) {
  const prefixo = `[${new Date().toLocaleTimeString()}] `;
  const detalhe = dados ? ` | ${serializarDebug(dados)}` : "";
  const linha = `${prefixo}${texto}${detalhe}\n`;
  els.debug.textContent = (els.debug.textContent + linha).slice(-DEBUG_MAX_CHARS);
  els.debug.scrollTop = els.debug.scrollHeight;
  console.log(texto, dados || "");
}

function serializarDebug(dados) {
  if (dados == null) {
    return "";
  }
  if (typeof dados === "string") {
    return dados;
  }
  if (Array.isArray(dados)) {
    return dados.map((item) => serializarDebug(item)).join(", ");
  }
  return Object.entries(dados)
    .map(([chave, valor]) => `${chave}=${formatarValorDebug(valor)}`)
    .join(" | ");
}

function formatarValorDebug(valor) {
  if (valor == null) {
    return String(valor);
  }
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor.toFixed(4) : String(valor);
  }
  if (typeof valor === "string") {
    return valor.replace(/\s+/g, " ").slice(0, 220);
  }
  try {
    return JSON.stringify(valor).slice(0, 220);
  } catch (_error) {
    return String(valor);
  }
}

function clamp(valor, min, max) {
  return Math.max(min, Math.min(max, valor));
}

function formatNumber(valor, casas = 2) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero.toFixed(casas) : "0";
}

function formatTimeMs(ms) {
  return `${formatNumber((ms || 0) / 1000, 2)}s`;
}

function percentileFromSorted(sortedValues, percentile) {
  if (!sortedValues.length) {
    return 0;
  }
  const pos = clamp(percentile, 0, 1) * (sortedValues.length - 1);
  const base = Math.floor(pos);
  const resto = pos - base;
  const atual = sortedValues[base];
  const proximo = sortedValues[Math.min(sortedValues.length - 1, base + 1)];
  return atual + (proximo - atual) * resto;
}

function computeVolumeStats(values) {
  const lista = (values || [])
    .map((valor) => Number(valor || 0))
    .filter((valor) => Number.isFinite(valor));

  if (!lista.length) {
    return {
      count: 0,
      min: 0,
      mean: 0,
      p15: 0,
      p50: 0,
      p85: 0,
      p95: 0,
      max: 0,
      spread: 0
    };
  }

  const sorted = [...lista].sort((a, b) => a - b);
  const total = lista.reduce((soma, valor) => soma + valor, 0);
  const p15 = percentileFromSorted(sorted, 0.15);
  const p50 = percentileFromSorted(sorted, 0.5);
  const p85 = percentileFromSorted(sorted, 0.85);
  const p95 = percentileFromSorted(sorted, 0.95);

  return {
    count: sorted.length,
    min: sorted[0],
    mean: total / sorted.length,
    p15,
    p50,
    p85,
    p95,
    max: sorted[sorted.length - 1],
    spread: Math.max(0, p95 - p15)
  };
}

function computeAdaptiveVoiceThresholdFromStats(stats, fallbackMin = VAD_VOL_MIN) {
  if (!stats || !stats.count) {
    return fallbackMin;
  }
  if (stats.max <= VAD_DYNAMIC_MIN * 1.2) {
    return fallbackMin;
  }

  const bySpread = stats.p15 + stats.spread * 0.28;
  const byPeak = stats.max * 0.45;
  const threshold = Math.min(Math.max(bySpread, VAD_DYNAMIC_MIN), byPeak);
  return clamp(threshold, VAD_DYNAMIC_MIN, VAD_DYNAMIC_MAX);
}

function getCurrentVoiceThreshold() {
  return clamp(
    Number(state.audioInfo.dynamicVoiceThreshold || VAD_VOL_MIN),
    VAD_DYNAMIC_MIN,
    VAD_DYNAMIC_MAX
  );
}

function zeroFeatures() {
  return {
    vol: 0,
    pit: 0,
    cent: 0,
    zcr: 0,
    ch: 0
  };
}

function textoTemConteudo(texto) {
  return typeof texto === "string" && texto.trim().length > 0;
}

function buildDefaultFeatureWeights(activeKeys = state.activeFeatureKeys) {
  const base = {
    vol: 0,
    pit: 0,
    cent: 0,
    zcr: 0,
    ch: 0
  };
  let total = 0;
  for (const key of activeKeys) {
    total += FEATURE_BASE_IMPORTANCE[key] || 0;
  }
  for (const key of activeKeys) {
    base[key] = (FEATURE_BASE_IMPORTANCE[key] || 0) / Math.max(EPSILON_PESO, total);
  }
  return base;
}

function updateFeatureConfiguration(hasRealStereo) {
  state.activeFeatureKeys = hasRealStereo
    ? ["vol", "pit", "cent", "zcr", "ch"]
    : ["vol", "pit", "cent", "zcr"];
  state.featureWeights = buildDefaultFeatureWeights(state.activeFeatureKeys);
}

function updateDynamicFeatureWeights() {
  const defaultWeights = buildDefaultFeatureWeights(state.activeFeatureKeys);
  if (!state.assinaturaIndividuo1 || !state.assinaturaIndividuo2) {
    state.featureWeights = defaultWeights;
    return;
  }

  const pesos = {
    vol: 0,
    pit: 0,
    cent: 0,
    zcr: 0,
    ch: 0
  };
  let soma = 0;

  for (const key of state.activeFeatureKeys) {
    const diff = Math.abs(
      (state.assinaturaIndividuo1.medias[key] || 0) -
      (state.assinaturaIndividuo2.medias[key] || 0)
    );
    const variabilidade =
      (state.assinaturaIndividuo1.desvios[key] || 0.04) +
      (state.assinaturaIndividuo2.desvios[key] || 0.04) +
      0.03;
    const score = Math.max(PESO_MINIMO_DINAMICO, diff / variabilidade) * (FEATURE_BASE_IMPORTANCE[key] || 0.01);
    pesos[key] = score;
    soma += score;
  }

  for (const key of state.activeFeatureKeys) {
    pesos[key] = pesos[key] / Math.max(EPSILON_PESO, soma);
  }

  state.featureWeights = {
    vol: pesos.vol || 0,
    pit: pesos.pit || 0,
    cent: pesos.cent || 0,
    zcr: pesos.zcr || 0,
    ch: state.activeFeatureKeys.includes("ch") ? pesos.ch || 0 : 0
  };

  debug("Pesos dinamicos recalculados.", {
    featuresAtivas: state.activeFeatureKeys.join(", "),
    pesos: formatarFeatures(state.featureWeights)
  });
}

function formatarFeatures(features) {
  return ALL_FEATURE_KEYS
    .map((key) => `${key}=${formatNumber(features[key] || 0, 3)}`)
    .join(", ");
}

function calibracoesConcluidas() {
  return !!state.assinaturaIndividuo1 && !!state.assinaturaIndividuo2;
}

function updateControls() {
  const prontoParaIniciar = calibracoesConcluidas() && !state.calibrando && !state.interview.active;
  els.btnIniciar.disabled = !prontoParaIniciar;
  els.btnFinalizar.disabled = !state.interview.active;
  els.btnCalibrarIndividuo1.disabled =
    !!state.calibrando || state.interview.active || !!state.calibrationWebhookPending["Individuo 1"];
  els.btnCalibrarIndividuo2.disabled =
    !!state.calibrando || state.interview.active || !!state.calibrationWebhookPending["Individuo 2"];
  els.btnCalibrarIndividuo1.classList.toggle("calibrado", !!state.assinaturaIndividuo1);
  els.btnCalibrarIndividuo2.classList.toggle("calibrado", !!state.assinaturaIndividuo2);
  updateCalibrationButtonVisual(
    els.btnCalibrarIndividuo1,
    "Calibrar Individuo 1",
    !!state.calibrationWebhookPending["Individuo 1"]
  );
  updateCalibrationButtonVisual(
    els.btnCalibrarIndividuo2,
    "Calibrar Individuo 2",
    !!state.calibrationWebhookPending["Individuo 2"]
  );
}

function updateCalibrationButtonVisual(botao, rotuloBase, aguardandoWebhook) {
  if (!botao) {
    return;
  }
  botao.classList.toggle("webhook-pending", aguardandoWebhook);
  botao.textContent = aguardandoWebhook ? `${rotuloBase} (Aguardando...)` : rotuloBase;
  botao.setAttribute("aria-busy", aguardandoWebhook ? "true" : "false");
}

function alternarModoDebug() {
  state.modoDebugAtivo = !state.modoDebugAtivo;
  updateDebugModeUI();
  renderizarSegmentosMarcados();
}

function updateDebugModeUI() {
  els.btnModoDebug.textContent = state.modoDebugAtivo ? "Ativar Modo Normal" : "Ativar Modo Debug";
  els.cardDebug.classList.toggle("is-collapsed", !state.modoDebugAtivo);
  els.debug.hidden = !state.modoDebugAtivo;
  els.promptEditor.hidden = !state.modoDebugAtivo;
  els.promptEditor.classList.toggle("is-hidden", !state.modoDebugAtivo);
  els.colunaTranscricaoFinal.hidden = !state.modoDebugAtivo;
  els.colunaTranscricaoFinal.classList.toggle("is-hidden", !state.modoDebugAtivo);
  els.resultadoGrid.classList.toggle("modo-normal", !state.modoDebugAtivo);
}

function updateAudioSummary() {
  const channelCountReal = state.audioInfo.channelCountReal || 0;
  const realLabel = channelCountReal > 0 ? `${channelCountReal} canal(is)` : "desconhecido";
  const stereoLabel = state.audioInfo.hasRealStereo ? "sim" : "nao";
  const mimeLabel = state.audioInfo.recorderMimeType || "a definir";
  els.audioResumo.textContent =
    `Captura tolerante em stereo | Real: ${realLabel} | Stereo real: ${stereoLabel} | ` +
    `Gravacao: mono derivado | Features: ${state.activeFeatureKeys.join(", ")} | Mime: ${mimeLabel}`;
}

function obterAudioConstraintsSolicitadas() {
  return {
    channelCount: { ideal: 2 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };
}

function escolherMimeType() {
  const candidatos = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ];
  for (const tipo of candidatos) {
    if (window.MediaRecorder && window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(tipo)) {
      return tipo;
    }
  }
  return "";
}

function nomeArquivo(mimeType) {
  if ((mimeType || "").includes("ogg")) {
    return "audio.ogg";
  }
  if ((mimeType || "").includes("mp4")) {
    return "audio.m4a";
  }
  return "audio.webm";
}

async function solicitarMicrofoneBruto() {
  const constraints = obterAudioConstraintsSolicitadas();
  state.audioInfo.requestedConstraints = constraints;
  debug("Solicitando microfone.", constraints);
  return navigator.mediaDevices.getUserMedia({ audio: constraints });
}

async function setupAudioEngine({ rawStream = null, mode = "entrevista" } = {}) {
  await teardownAudioEngine();

  const stream = rawStream || await solicitarMicrofoneBruto();
  const track = stream.getAudioTracks()[0] || null;
  const trackSettings = track && typeof track.getSettings === "function" ? track.getSettings() : {};
  const channelCountReal = Number(trackSettings.channelCount || 0);
  const hasRealStereo = channelCountReal >= 2;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error("AudioContext indisponivel no navegador.");
  }

  const audioContext = new AudioContextCtor();
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (error) {
      debug("Falha ao retomar AudioContext.", { erro: error.message || String(error) });
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
  splitter.connect(analyserR, hasRealStereo ? 1 : 0);

  const monoGainL = audioContext.createGain();
  const monoGainR = audioContext.createGain();
  const monoBus = audioContext.createGain();
  const monitorGain = audioContext.createGain();
  const monoDestination = audioContext.createMediaStreamDestination();
  monoGainL.gain.value = hasRealStereo ? 0.5 : 1;
  monoGainR.gain.value = 0.5;
  monitorGain.gain.value = 0;
  monoBus.channelCount = 1;
  monoBus.channelCountMode = "explicit";
  monoBus.channelInterpretation = "speakers";

  splitter.connect(monoGainL, 0);
  monoGainL.connect(monoBus);
  if (hasRealStereo) {
    splitter.connect(monoGainR, 1);
    monoGainR.connect(monoBus);
  }
  monoBus.connect(monoDestination);
  monoBus.connect(monitorGain);
  monitorGain.connect(audioContext.destination);

  const recordingTrack = monoDestination.stream.getAudioTracks()[0] || null;
  const recordingSettings = recordingTrack && typeof recordingTrack.getSettings === "function"
    ? recordingTrack.getSettings()
    : {};

  state.audio = {
    rawStream: stream,
    recordingStream: monoDestination.stream,
    audioContext,
    source,
    splitter,
    analyserL,
    analyserR,
    monoGainL,
    monoGainR,
    monoBus,
    monitorGain,
    monoDestination,
    floatL: new Float32Array(analyserL.fftSize),
    floatR: new Float32Array(analyserR.fftSize),
    freqL: new Uint8Array(analyserL.frequencyBinCount),
    freqR: new Uint8Array(analyserR.frequencyBinCount),
    avgFreq: new Uint8Array(analyserL.frequencyBinCount),
    featureTimer: null
  };

  state.audioInfo.trackSettings = trackSettings;
  state.audioInfo.recordingSettings = recordingSettings;
  state.audioInfo.channelCountReal = channelCountReal;
  state.audioInfo.hasRealStereo = hasRealStereo;
  state.audioInfo.dynamicVoiceThreshold = VAD_VOL_MIN;
  state.audioInfo.recentVolumes = [];
  state.audioInfo.lastVolumeLogAtMs = 0;
  updateFeatureConfiguration(hasRealStereo);
  updateDynamicFeatureWeights();
  updateAudioSummary();
  startFeatureLoop();

  debug("Audio inicializado.", {
    mode,
    channelCountReal: channelCountReal || "desconhecido",
    stereoReal: hasRealStereo,
    trackSettings,
    recordingSettings,
    chAtivo: state.activeFeatureKeys.includes("ch")
  });
}

async function teardownAudioEngine() {
  stopFeatureLoop();
  safeDisconnect(state.audio.monitorGain);
  safeDisconnect(state.audio.monoBus);
  safeDisconnect(state.audio.monoGainL);
  safeDisconnect(state.audio.monoGainR);
  safeDisconnect(state.audio.analyserL);
  safeDisconnect(state.audio.analyserR);
  safeDisconnect(state.audio.splitter);
  safeDisconnect(state.audio.source);

  if (state.audio.rawStream) {
    state.audio.rawStream.getTracks().forEach((track) => track.stop());
  }

  if (state.audio.audioContext) {
    try {
      await state.audio.audioContext.close();
    } catch (error) {
      debug("Aviso ao fechar AudioContext.", { erro: error.message || String(error) });
    }
  }

  state.audio = createEmptyAudioState();
}

function safeDisconnect(node) {
  if (!node || typeof node.disconnect !== "function") {
    return;
  }
  try {
    node.disconnect();
  } catch (_error) {
    // noop
  }
}

function startFeatureLoop() {
  stopFeatureLoop();
  state.audio.featureTimer = window.setInterval(capturarFeatureFrame, FEATURE_INTERVAL_MS);
}

function stopFeatureLoop() {
  if (!state.audio.featureTimer) {
    return;
  }
  window.clearInterval(state.audio.featureTimer);
  state.audio.featureTimer = null;
}

function capturarFeatureFrame() {
  if (!state.audio.analyserL || !state.audio.analyserR) {
    return;
  }

  state.audio.analyserL.getFloatTimeDomainData(state.audio.floatL);
  state.audio.analyserR.getFloatTimeDomainData(state.audio.floatR);
  state.audio.analyserL.getByteFrequencyData(state.audio.freqL);
  state.audio.analyserR.getByteFrequencyData(state.audio.freqR);

  const rmsL = rms(state.audio.floatL);
  const rmsR = state.audioInfo.hasRealStereo ? rms(state.audio.floatR) : rmsL;
  const mix = criarSinalMixado(state.audio.floatL, state.audio.floatR);

  for (let i = 0; i < state.audio.avgFreq.length; i += 1) {
    state.audio.avgFreq[i] = (state.audio.freqL[i] + state.audio.freqR[i]) * 0.5;
  }

  const feature = {
    time: performance.now(),
    vol: clamp((rmsL + rmsR) * 0.5, 0, 1),
    pit: detectarPitchNormalizado(mix, state.audio.audioContext.sampleRate),
    cent: calcularCentroidNormalizado(state.audio.avgFreq, state.audio.audioContext.sampleRate),
    zcr: calcularZeroCrossingRate(mix),
    ch: state.audioInfo.hasRealStereo
      ? clamp((rmsL - rmsR) / (rmsL + rmsR + 1e-6), -1, 1)
      : 0
  };

  state.ultimoFeature = feature;
  state.timeline.push(feature);
  pruneTimeline();

  state.audioInfo.recentVolumes.push(feature.vol || 0);
  if (state.audioInfo.recentVolumes.length > RECENT_VOLUME_HISTORY_MAX) {
    state.audioInfo.recentVolumes.shift();
  }
  if (state.audioInfo.recentVolumes.length >= 12) {
    const stats = computeVolumeStats(state.audioInfo.recentVolumes);
    state.audioInfo.dynamicVoiceThreshold = computeAdaptiveVoiceThresholdFromStats(stats, VAD_VOL_MIN);

    const agora = feature.time;
    if (
      (state.calibrando || state.interview.active) &&
      agora - (state.audioInfo.lastVolumeLogAtMs || 0) >= VOLUME_LOG_INTERVAL_MS
    ) {
      state.audioInfo.lastVolumeLogAtMs = agora;
      debug("Amostra de volume atual.", {
        contexto: state.calibrando ? "calibracao" : "entrevista",
        volAtual: feature.vol,
        threshold: state.audioInfo.dynamicVoiceThreshold,
        volMin: stats.min,
        volP50: stats.p50,
        volP95: stats.p95,
        volMax: stats.max
      });
    }
  }

  if (state.calibrando) {
    state.calibrationBuffer.push(feature);
  }

  if (state.interview.active && isVoiceFrame(feature)) {
    state.interview.logicalSegmentHadVoice = true;
    state.interview.logicalSegmentLastVoiceAtMs = feature.time;
  }
}

function pruneTimeline() {
  const floorByAge = performance.now() - RETENCAO_TIMELINE_MS;
  const floorBySegment = state.interview.active
    ? Math.max(0, state.interview.logicalSegmentStartMs - AUDIO_PART_PRUNE_MARGIN_MS)
    : floorByAge;
  const floor = Math.min(floorByAge, floorBySegment);
  while (state.timeline.length && state.timeline[0].time < floor) {
    state.timeline.shift();
  }
}

function rms(buffer) {
  if (!buffer || !buffer.length) {
    return 0;
  }
  let soma = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    soma += buffer[i] * buffer[i];
  }
  return Math.sqrt(soma / buffer.length);
}

function criarSinalMixado(left, right) {
  const tamanho = Math.min(left.length, right.length);
  const out = new Float32Array(tamanho);
  for (let i = 0; i < tamanho; i += 1) {
    out[i] = (left[i] + right[i]) * 0.5;
  }
  return out;
}

function detectarPitchNormalizado(buffer, sampleRate) {
  const freq = autoCorrelacaoPitch(buffer, sampleRate);
  if (!freq) {
    return 0;
  }
  return clamp((freq - 75) / (350 - 75), 0, 1);
}

function autoCorrelacaoPitch(buffer, sampleRate) {
  const tamanho = Math.min(buffer.length, 2048);
  if (tamanho < 128) {
    return 0;
  }

  let energia = 0;
  for (let i = 0; i < tamanho; i += 1) {
    energia += buffer[i] * buffer[i];
  }
  if (Math.sqrt(energia / tamanho) < 0.01) {
    return 0;
  }

  const minLag = Math.floor(sampleRate / 350);
  const maxLag = Math.floor(sampleRate / 75);
  let melhorLag = 0;
  let melhorCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let soma = 0;
    for (let i = 0; i < tamanho - lag; i += 1) {
      soma += buffer[i] * buffer[i + lag];
    }
    if (soma > melhorCorr) {
      melhorCorr = soma;
      melhorLag = lag;
    }
  }

  if (!melhorLag || melhorCorr <= 0) {
    return 0;
  }
  return sampleRate / melhorLag;
}

function calcularZeroCrossingRate(buffer) {
  if (!buffer || buffer.length < 2) {
    return 0;
  }
  let cruzamentos = 0;
  let ultimo = buffer[0] >= 0;
  for (let i = 1; i < buffer.length; i += 1) {
    const atual = buffer[i] >= 0;
    if (atual !== ultimo) {
      cruzamentos += 1;
      ultimo = atual;
    }
  }
  return clamp(cruzamentos / buffer.length, 0, 1);
}

function calcularCentroidNormalizado(freq, sampleRate) {
  let somaMag = 0;
  let somaFreq = 0;
  const nyquist = sampleRate * 0.5;
  const tamanho = freq.length;

  for (let i = 0; i < tamanho; i += 1) {
    const mag = freq[i];
    const hz = (i / Math.max(1, tamanho - 1)) * nyquist;
    somaMag += mag;
    somaFreq += hz * mag;
  }

  if (somaMag <= 0) {
    return 0;
  }

  const centroid = somaFreq / somaMag;
  return clamp((centroid - 80) / (4000 - 80), 0, 1);
}

function isVoiceFrame(frame) {
  return !!frame && (frame.vol || 0) >= getCurrentVoiceThreshold();
}

function agregarFeaturesSegmento(frames) {
  if (!frames || !frames.length) {
    return null;
  }
  const medias = zeroFeatures();
  for (const frame of frames) {
    for (const key of ALL_FEATURE_KEYS) {
      medias[key] += frame[key] || 0;
    }
  }
  for (const key of ALL_FEATURE_KEYS) {
    medias[key] /= frames.length;
  }
  return medias;
}

function construirAssinatura(frames) {
  if (!frames || !frames.length) {
    return null;
  }
  const medias = agregarFeaturesSegmento(frames);
  const desvios = zeroFeatures();

  for (const frame of frames) {
    for (const key of ALL_FEATURE_KEYS) {
      const delta = (frame[key] || 0) - (medias[key] || 0);
      desvios[key] += delta * delta;
    }
  }

  for (const key of ALL_FEATURE_KEYS) {
    desvios[key] = Math.sqrt(desvios[key] / Math.max(1, frames.length));
  }

  return { medias, desvios };
}

function classificarFramesCalibracao(framesBrutos) {
  const frames = Array.isArray(framesBrutos) ? framesBrutos : [];
  const stats = computeVolumeStats(frames.map((frame) => frame.vol || 0));
  const threshold = computeAdaptiveVoiceThresholdFromStats(stats, CALIBRACAO_VOL_MIN);
  let validos = frames.filter((frame) => (frame.vol || 0) >= threshold);
  let fallbackTopFrames = false;

  if (
    validos.length < CALIBRACAO_MIN_FRAMES_VOZ &&
    frames.length >= CALIBRACAO_MIN_FRAMES_VOZ &&
    stats.max >= VAD_DYNAMIC_MIN * 1.8
  ) {
    const candidatos = [...frames]
      .sort((a, b) => (b.vol || 0) - (a.vol || 0))
      .slice(0, Math.min(16, Math.max(CALIBRACAO_MIN_FRAMES_VOZ, Math.round(frames.length * 0.18))))
      .filter((frame) => (frame.vol || 0) >= Math.max(VAD_DYNAMIC_MIN, stats.max * 0.42));

    if (candidatos.length >= CALIBRACAO_MIN_FRAMES_VOZ) {
      validos = candidatos;
      fallbackTopFrames = true;
    }
  }

  return {
    validos,
    threshold,
    stats,
    fallbackTopFrames
  };
}

function nomeAtualDoIndividuo(chave) {
  return chave === "Individuo 1"
    ? (state.nomeIndividuo1 || "Individuo 1")
    : (state.nomeIndividuo2 || "Individuo 2");
}

function gravarAssinatura(chave, assinatura) {
  if (chave === "Individuo 1") {
    state.assinaturaIndividuo1 = assinatura;
  } else {
    state.assinaturaIndividuo2 = assinatura;
  }
}

function gravarNomeDoIndividuo(chave, nome) {
  if (!textoTemConteudo(nome)) {
    return;
  }
  if (chave === "Individuo 1") {
    state.nomeIndividuo1 = nome;
  } else {
    state.nomeIndividuo2 = nome;
  }
}

async function gravarBlobDoStream(stream, duracaoMs, contexto = "calibracao") {
  if (!window.MediaRecorder) {
    throw new Error("MediaRecorder indisponivel no navegador.");
  }

  const mimeType = escolherMimeType();
  const opcoes = mimeType
    ? { mimeType, audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND }
    : { audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND };
  const chunks = [];
  const recorder = new MediaRecorder(stream, opcoes);

  debug("Iniciando gravacao curta.", {
    contexto,
    mimeEscolhido: mimeType || "(default)",
    bitrate: RECORDER_AUDIO_BITS_PER_SECOND
  });

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  await new Promise((resolve, reject) => {
    recorder.onerror = (event) => reject(event.error || new Error("falha na gravacao"));
    recorder.onstop = () => resolve();
    recorder.start(RECORDER_TIMESLICE_MS);
    window.setTimeout(() => {
      try {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch (error) {
        reject(error);
      }
    }, duracaoMs);
  });

  const blob = new Blob(chunks, {
    type: mimeType || (chunks[0] && chunks[0].type) || "audio/webm"
  });

  debug("Gravacao curta encerrada.", {
    contexto,
    blobType: blob.type || "(vazio)",
    blobSize: blob.size
  });

  return blob;
}

async function calibrar(chave) {
  if (state.interview.active) {
    setStatus("Status: finalize a entrevista antes de calibrar.");
    return;
  }
  if (state.calibrationWebhookPending[chave]) {
    setStatus(`Status: ${chave} ainda aguardando resposta do webhook.`);
    return;
  }
  if (state.calibrando) {
    setStatus("Status: ja existe calibracao em andamento.");
    return;
  }

  let blobCalibracao = null;
  state.calibrando = chave;
  state.calibrationBuffer = [];
  updateControls();

  try {
    setStatus(`Status: capturando calibracao de ${chave} por ${CALIBRACAO_MS / 1000}s...`);
    const rawStream = await solicitarMicrofoneBruto();
    await setupAudioEngine({ rawStream, mode: "calibracao" });
    blobCalibracao = await gravarBlobDoStream(state.audio.recordingStream, CALIBRACAO_MS, "calibracao");

    const diagnosticoCalibracao = classificarFramesCalibracao(state.calibrationBuffer.slice());
    const framesVoz = diagnosticoCalibracao.validos;
    debug("Diagnostico da calibracao.", {
      chave,
      framesTotal: state.calibrationBuffer.length,
      framesVoz: framesVoz.length,
      threshold: diagnosticoCalibracao.threshold,
      volMin: diagnosticoCalibracao.stats.min,
      volP50: diagnosticoCalibracao.stats.p50,
      volP95: diagnosticoCalibracao.stats.p95,
      volMax: diagnosticoCalibracao.stats.max,
      fallbackTopFrames: diagnosticoCalibracao.fallbackTopFrames
    });
    if (framesVoz.length < CALIBRACAO_MIN_FRAMES_VOZ) {
      setStatus("Status: poucos frames de voz na calibracao. Tente novamente falando perto e continuo.");
      debug("Falha na calibracao por poucos frames de voz.", {
        chave,
        framesVoz: framesVoz.length,
        threshold: diagnosticoCalibracao.threshold,
        volMax: diagnosticoCalibracao.stats.max
      });
      return;
    }

    const assinatura = construirAssinatura(framesVoz);
    if (!assinatura) {
      setStatus(`Status: falha na calibracao de ${chave}.`);
      return;
    }

    gravarAssinatura(chave, assinatura);
    updateDynamicFeatureWeights();
    setStatus(`Status: assinatura de ${chave} concluida (${nomeAtualDoIndividuo(chave)}). Aguardando transcricao do nome...`);
    debug("Assinatura calibrada.", {
      chave,
      framesVoz: framesVoz.length,
      medias: formatarFeatures(assinatura.medias),
      desvios: formatarFeatures(assinatura.desvios)
    });
  } catch (error) {
    setStatus("Status: erro na calibracao.");
    debug("Erro na calibracao.", { chave, erro: error.message || String(error) });
  } finally {
    state.calibrando = null;
    state.calibrationBuffer = [];
    await teardownAudioEngine();
    updateControls();
  }

  if (!blobCalibracao) {
    return;
  }

  state.calibrationWebhookPending[chave] = true;
  updateControls();

  try {
    const resposta = await enviarBlobParaWebhook(blobCalibracao, {
      contexto: "calibracao",
      duracaoMs: CALIBRACAO_MS,
      idioma: "pt",
      channelCountReal: state.audioInfo.channelCountReal || 0
    });
    const texto = (resposta.texto || "").trim();
    const nomeExtraido = extrairNomeDaCalibracao(texto);
    if (nomeExtraido) {
      gravarNomeDoIndividuo(chave, nomeExtraido);
    }
    setStatus(`Status: calibracao de ${chave} concluida (${nomeAtualDoIndividuo(chave)}).`);
    debug("Transcricao da calibracao recebida.", {
      chave,
      texto,
      nomeExtraido: nomeExtraido || "(mantido)"
    });
  } catch (error) {
    setStatus(`Status: assinatura de ${chave} ok, mas falha na transcricao do nome.`);
    debug("Erro na transcricao da calibracao.", {
      chave,
      erro: error.message || String(error)
    });
  } finally {
    state.calibrationWebhookPending[chave] = false;
    updateControls();
  }
}

function prepararTextoTranscricaoFinal(texto) {
  return texto == null ? "" : String(texto);
}

function normalizarTokenNome(token) {
  if (!token) {
    return "";
  }
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function contemLetraLatina(valor) {
  return /[\p{Script=Latin}]/u.test(valor || "");
}

function normalizarNomeExtraido(nome) {
  if (!nome) {
    return "";
  }
  const stopwords = new Set([
    "meu", "nome", "\u00e9", "e", "eu", "sou", "me", "chamo",
    "o", "a", "um", "uma", "de", "da", "do", "dos", "das",
    "senhor", "senhora", "sr", "sra", "aqui"
  ]);
  const tokens = (nome.match(/[\p{L}][\p{L}'-]*/gu) || [])
    .map((token) => token.trim())
    .filter((token) => token && contemLetraLatina(token))
    .filter((token) => !stopwords.has(token.toLowerCase()));
  if (!tokens.length) {
    return "";
  }
  return normalizarTokenNome(tokens[0]);
}

function extrairNomeDaCalibracao(texto) {
  const cru = prepararTextoTranscricaoFinal(texto);
  if (!cru) {
    return "";
  }

  const limpo = cru
    .replace(/[.,!?;:()[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpo) {
    return "";
  }

  const padroes = [
    /(?:meu nome(?:\s+\u00e9|\s+e)?|me chamo|eu sou|sou o|sou a|aqui \u00e9|aqui e)\s+(.+)$/iu
  ];

  for (const regex of padroes) {
    const match = limpo.match(regex);
    if (match && match[1]) {
      return normalizarNomeExtraido(match[1].trim());
    }
  }

  const tokens = limpo.match(/[\p{L}][\p{L}'-]*/gu) || [];
  if (!tokens.length) {
    return "";
  }
  return normalizarNomeExtraido(tokens[tokens.length - 1]);
}

function dist(features, assinatura) {
  if (!features || !assinatura) {
    return Number.POSITIVE_INFINITY;
  }
  let soma = 0;
  for (const key of state.activeFeatureKeys) {
    const base = assinatura.medias[key] || 0;
    const faixa = assinatura.desvios[key] || 0.06;
    const z = ((features[key] || 0) - base) / (faixa + 0.02);
    const peso = state.featureWeights[key] || 0;
    soma += Math.abs(z) * peso;
  }
  return soma;
}

function classificarSpeaker(features) {
  if (!features || !state.assinaturaIndividuo1 || !state.assinaturaIndividuo2) {
    return { spk: "?", conf: 0, delta: 0, d1: 0, d2: 0 };
  }

  const d1 = dist(features, state.assinaturaIndividuo1);
  const d2 = dist(features, state.assinaturaIndividuo2);
  const delta = Math.abs(d1 - d2);
  let spk = d1 < d2 ? (state.nomeIndividuo1 || "Individuo 1") : (state.nomeIndividuo2 || "Individuo 2");
  if (delta < SPEAKER_CONF_MIN_DELTA) {
    spk = "?";
  }
  return {
    spk,
    conf: clamp(delta / 0.8, 0, 1),
    delta,
    d1,
    d2
  };
}

function resetarSaidaEntrevista() {
  state.segmentosMarcados = [];
  state.transcricaoFinalPartes = [];
  state.timeline = [];
  state.ultimoFeature = null;
  els.resultadoSegmentos.innerHTML = "";
  els.transcricaoFinal.textContent = "";
  resetInterviewRuntime();
}

function iniciarSegmentoLogico(startMs) {
  state.interview.logicalSegmentStartMs = startMs;
  state.interview.logicalSegmentHadVoice = false;
  state.interview.logicalSegmentLastVoiceAtMs = startMs;
  debug("Segmento logico aberto.", {
    inicio: formatTimeMs(startMs)
  });
}

function getLatestAvailableAudioEndMs() {
  return state.interview.latestRecordedAudioEndMs || state.interview.recorderStartMs || performance.now();
}

function handleRecorderDataAvailable(event) {
  if (!event.data || event.data.size === 0) {
    return;
  }

  const inicio = state.interview.latestRecordedAudioEndMs || state.interview.recorderStartMs || performance.now();
  const fim = performance.now();
  state.interview.audioParts.push({
    blob: event.data,
    startMs: inicio,
    endMs: fim
  });
  state.interview.latestRecordedAudioEndMs = fim;
  state.interview.audioChunkCount += 1;

  if (!state.audioInfo.recorderMimeType && event.data.type) {
    state.audioInfo.recorderMimeType = event.data.type;
    updateAudioSummary();
  }

  pruneAudioParts();

  if (state.interview.audioChunkCount === 1 || state.interview.audioChunkCount % 8 === 0) {
    debug("Chunk do recorder continuo recebido.", {
      chunkIndex: state.interview.audioChunkCount,
      blobType: event.data.type || state.audioInfo.recorderMimeType || "(default)",
      blobSize: event.data.size,
      ate: formatTimeMs(fim)
    });
  }
}

function pruneAudioParts() {
  const keepFrom = Math.max(0, state.interview.logicalSegmentStartMs - AUDIO_PART_PRUNE_MARGIN_MS);
  while (state.interview.audioParts.length && state.interview.audioParts[0].endMs < keepFrom) {
    state.interview.audioParts.shift();
  }
}

function construirBlobSegmento(startMs, endMs) {
  const partes = state.interview.audioParts.filter((parte) => (
    parte.endMs > (startMs - SEGMENT_AUDIO_OVERLAP_MS) &&
    parte.startMs < (endMs + SEGMENT_AUDIO_OVERLAP_MS)
  ));

  if (!partes.length) {
    return null;
  }

  const tipo =
    partes.find((parte) => textoTemConteudo(parte.blob.type))?.blob.type ||
    state.audioInfo.recorderMimeType ||
    "audio/webm";

  return {
    blob: new Blob(partes.map((parte) => parte.blob), { type: tipo }),
    partCount: partes.length,
    audioStartMs: partes[0].startMs,
    audioEndMs: partes[partes.length - 1].endMs
  };
}

function coletarFramesNoIntervalo(startMs, endMs) {
  return state.timeline.filter((frame) => frame.time >= startMs && frame.time <= endMs);
}

function nextSegmentId() {
  state.interview.segmentCounter += 1;
  return `seg-${String(state.interview.segmentCounter).padStart(3, "0")}`;
}

function computeSegmentStrength(metrics) {
  let weakSignals = 0;
  let veryWeakSignals = 0;

  if (metrics.durationMs < 900) {
    veryWeakSignals += 2;
  } else if (metrics.durationMs < 2200) {
    weakSignals += 1;
  }

  if (metrics.framesVoz < 3) {
    veryWeakSignals += 2;
  } else if (metrics.framesVoz < 7) {
    weakSignals += 1;
  }

  if (metrics.vozRatio < 0.08) {
    veryWeakSignals += 1;
  } else if (metrics.vozRatio < 0.18) {
    weakSignals += 1;
  }

  if (metrics.blobSize < 1200) {
    veryWeakSignals += 2;
  } else if (metrics.blobSize < 3200) {
    weakSignals += 1;
  }

  if (veryWeakSignals >= 2) {
    return "muito_fraco";
  }
  if (weakSignals + veryWeakSignals >= 2) {
    return "fraco";
  }
  return "ok";
}

function calcularMetricasSegmento(segmento) {
  const frames = Array.isArray(segmento.frames) ? segmento.frames : [];
  const framesVozLista = frames.filter(isVoiceFrame);
  const framesTotal = frames.length;
  const framesVoz = framesVozLista.length;
  const vozRatio = framesTotal > 0 ? framesVoz / framesTotal : 0;
  const durationMs = Math.max(0, (segmento.endMs || 0) - (segmento.startMs || 0));
  const blobSize = segmento.blob ? segmento.blob.size : 0;
  const mimeType = segmento.blob ? (segmento.blob.type || state.audioInfo.recorderMimeType || "") : "";
  const averageFeatures = agregarFeaturesSegmento(framesVozLista.length ? framesVozLista : frames) || zeroFeatures();
  const speaker = classificarSpeaker(averageFeatures);
  const classificacao = computeSegmentStrength({
    durationMs,
    framesTotal,
    framesVoz,
    vozRatio,
    blobSize
  });

  return {
    durationMs,
    framesTotal,
    framesVoz,
    vozRatio,
    blobSize,
    mimeType,
    reason: segmento.reason,
    averageFeatures,
    speaker,
    classification: classificacao,
    wasMerged: !!segmento.wasMerged,
    channelCountReal: state.audioInfo.channelCountReal || 0,
    voiceThreshold: getCurrentVoiceThreshold(),
    audioStartMs: segmento.audioStartMs ?? segmento.startMs,
    audioEndMs: segmento.audioEndMs ?? segmento.endMs,
    partCount: segmento.partCount || 0
  };
}

function debugSegmento(texto, segmento, metricas) {
  debug(texto, {
    id: segmento.id,
    motivo: segmento.reason,
    duracaoMs: metricas.durationMs,
    framesTotal: metricas.framesTotal,
    framesVoz: metricas.framesVoz,
    vozRatio: metricas.vozRatio,
    blobSize: metricas.blobSize,
    mimeType: metricas.mimeType || "(vazio)",
    channelCountReal: metricas.channelCountReal || "desconhecido",
    voiceThreshold: metricas.voiceThreshold,
    classificacao: metricas.classification,
    speaker: metricas.speaker.spk,
    conf: metricas.speaker.conf,
    delta: metricas.speaker.delta,
    medias: formatarFeatures(metricas.averageFeatures),
    fundido: metricas.wasMerged
  });
}

function mergeSegmentos(primeiro, segundo) {
  return {
    id: `${primeiro.id}+${segundo.id}`,
    reason: `${primeiro.reason}+${segundo.reason}`,
    startMs: Math.min(primeiro.startMs, segundo.startMs),
    endMs: Math.max(primeiro.endMs, segundo.endMs),
    audioStartMs: Math.min(primeiro.audioStartMs || primeiro.startMs, segundo.audioStartMs || segundo.startMs),
    audioEndMs: Math.max(primeiro.audioEndMs || primeiro.endMs, segundo.audioEndMs || segundo.endMs),
    blob: new Blob([primeiro.blob, segundo.blob], {
      type: segundo.blob.type || primeiro.blob.type || state.audioInfo.recorderMimeType || "audio/webm"
    }),
    partCount: (primeiro.partCount || 0) + (segundo.partCount || 0),
    frames: [...(primeiro.frames || []), ...(segundo.frames || [])],
    final: !!(primeiro.final || segundo.final),
    wasMerged: true,
    mergedIds: [...(primeiro.mergedIds || [primeiro.id]), ...(segundo.mergedIds || [segundo.id])]
  };
}

function closeLogicalSegment(reason, { force = false, final = false } = {}) {
  if (state.interview.closingLogicalSegment) {
    return false;
  }

  const availableEndMs = getLatestAvailableAudioEndMs();
  const startMs = state.interview.logicalSegmentStartMs;
  if (!force && availableEndMs - startMs < 300) {
    return false;
  }

  const blobInfo = construirBlobSegmento(startMs, availableEndMs);
  if (!blobInfo || !blobInfo.blob || blobInfo.blob.size === 0) {
    if (force) {
      debug("Nao houve blob disponivel para fechar o segmento.", {
        motivo: reason,
        startMs: formatTimeMs(startMs),
        endMs: formatTimeMs(availableEndMs)
      });
    }
    return false;
  }

  state.interview.closingLogicalSegment = true;

  const segmento = {
    id: nextSegmentId(),
    reason,
    startMs,
    endMs: availableEndMs,
    audioStartMs: blobInfo.audioStartMs,
    audioEndMs: blobInfo.audioEndMs,
    blob: blobInfo.blob,
    partCount: blobInfo.partCount,
    frames: coletarFramesNoIntervalo(startMs, availableEndMs),
    final,
    wasMerged: false,
    mergedIds: []
  };

  debug("Segmento logico fechado.", {
    id: segmento.id,
    motivo: reason,
    inicio: formatTimeMs(segmento.startMs),
    fim: formatTimeMs(segmento.endMs),
    blobType: segmento.blob.type || "(vazio)",
    blobSize: segmento.blob.size,
    partCount: segmento.partCount
  });

  const nextStartMs = final
    ? availableEndMs
    : Math.max(startMs, availableEndMs - SEGMENT_AUDIO_OVERLAP_MS);

  if (!final) {
    iniciarSegmentoLogico(nextStartMs);
  }

  pruneTimeline();
  pruneAudioParts();

  state.interview.uploadQueue = state.interview.uploadQueue
    .then(() => processarSegmentoFechado(segmento))
    .catch((error) => {
      debug("Erro na fila de upload.", {
        segmento: segmento.id,
        erro: error.message || String(error)
      });
    });

  state.interview.closingLogicalSegment = false;
  return true;
}

async function processarSegmentoFechado(segmento) {
  const metricas = calcularMetricasSegmento(segmento);
  debugSegmento("Metricas do segmento calculadas.", segmento, metricas);

  if (state.interview.pendingWeakSegment) {
    const combinado = mergeSegmentos(state.interview.pendingWeakSegment, segmento);
    state.interview.pendingWeakSegment = null;
    const metricasCombinadas = calcularMetricasSegmento(combinado);

    debug("Segmento fundido com pendencia anterior.", {
      novoId: combinado.id,
      mergedIds: combinado.mergedIds.join(", "),
      classificacao: metricasCombinadas.classification
    });

    if (metricasCombinadas.classification === "ok" || combinado.final || state.interview.finalizing) {
      await enviarSegmentoAoWebhook(combinado, metricasCombinadas);
      return;
    }

    state.interview.pendingWeakSegment = combinado;
    debug("Segmento fundido mantido como pendente.", {
      id: combinado.id,
      classificacao: metricasCombinadas.classification
    });
    return;
  }

  if (metricas.classification === "ok" || segmento.final || state.interview.finalizing) {
    await enviarSegmentoAoWebhook(segmento, metricas);
    return;
  }

  state.interview.pendingWeakSegment = segmento;
  debug("Segmento acumulado para fusao.", {
    id: segmento.id,
    classificacao: metricas.classification,
    motivo: segmento.reason
  });
}

async function flushPendenteFinal() {
  if (!state.interview.pendingWeakSegment) {
    return;
  }

  const pendente = state.interview.pendingWeakSegment;
  state.interview.pendingWeakSegment = null;
  pendente.final = true;
  pendente.reason = `${pendente.reason}+flush_final_pendente`;
  const metricas = calcularMetricasSegmento(pendente);

  debug("Flush final do segmento pendente.", {
    id: pendente.id,
    classificacao: metricas.classification
  });

  await enviarSegmentoAoWebhook(pendente, metricas);
}

function startContinuousRecorder() {
  if (!window.MediaRecorder) {
    throw new Error("MediaRecorder indisponivel no navegador.");
  }

  const mimeType = escolherMimeType();
  const opcoes = mimeType
    ? { mimeType, audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND }
    : { audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND };
  const recorder = new MediaRecorder(state.audio.recordingStream, opcoes);

  state.interview.recorder = recorder;
  state.interview.recorderMimeType = mimeType || "";
  state.interview.recorderStartMs = performance.now();
  state.interview.latestRecordedAudioEndMs = state.interview.recorderStartMs;
  state.audioInfo.recorderMimeType = mimeType || "";
  updateAudioSummary();

  recorder.ondataavailable = handleRecorderDataAvailable;
  recorder.onerror = (event) => {
    debug("Erro do MediaRecorder continuo.", {
      erro: event.error ? (event.error.message || String(event.error)) : "desconhecido"
    });
  };
  recorder.onstart = () => {
    state.audioInfo.recorderMimeType = recorder.mimeType || mimeType || "";
    updateAudioSummary();
    debug("MediaRecorder continuo iniciado.", {
      mimeEscolhido: mimeType || "(default)",
      mimeReal: recorder.mimeType || "(default)",
      bitrate: RECORDER_AUDIO_BITS_PER_SECOND,
      timeslice: RECORDER_TIMESLICE_MS
    });
  };
  recorder.onstop = () => {
    debug("MediaRecorder continuo finalizado.");
  };

  recorder.start(RECORDER_TIMESLICE_MS);
}

function stopContinuousRecorder() {
  const recorder = state.interview.recorder;
  if (!recorder || recorder.state === "inactive") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onStop = () => resolve();
    const onError = (event) => reject(event.error || new Error("falha ao parar recorder continuo"));
    recorder.addEventListener("stop", onStop, { once: true });
    recorder.addEventListener("error", onError, { once: true });
    try {
      recorder.stop();
    } catch (error) {
      reject(error);
    }
  });
}

function startSegmentMonitor() {
  stopSegmentMonitor();
  state.interview.segmentMonitorTimer = window.setInterval(monitorarSegmentacao, SEGMENT_MONITOR_MS);
}

function stopSegmentMonitor() {
  if (!state.interview.segmentMonitorTimer) {
    return;
  }
  window.clearInterval(state.interview.segmentMonitorTimer);
  state.interview.segmentMonitorTimer = null;
}

function monitorarSegmentacao() {
  if (!state.interview.active || state.interview.closingLogicalSegment) {
    return;
  }

  const availableEndMs = getLatestAvailableAudioEndMs();
  const durationMs = Math.max(0, availableEndMs - state.interview.logicalSegmentStartMs);

  if (!state.interview.logicalSegmentHadVoice) {
    if (durationMs >= SEGMENT_MAX_SEM_VOZ_MS) {
      closeLogicalSegment("sem_voz_prolongado");
    }
    return;
  }

  if (state.interview.logicalSegmentLastVoiceAtMs > availableEndMs) {
    return;
  }

  const silencioMs = Math.max(0, availableEndMs - state.interview.logicalSegmentLastVoiceAtMs);
  if (durationMs >= SEGMENT_MAX_MS) {
    closeLogicalSegment("tempo_maximo");
    return;
  }
  if (durationMs >= SEGMENT_MIN_MS && silencioMs >= SEGMENT_SILENCE_CUT_MS) {
    closeLogicalSegment("silencio_pos_voz");
  }
}

async function enviarSegmentoAoWebhook(segmento, metricas) {
  const resposta = await enviarBlobParaWebhook(segmento.blob, {
    contexto: "entrevista",
    duracaoMs: metricas.durationMs,
    idioma: "pt",
    chunkInicioMs: segmento.startMs,
    chunkFimMs: segmento.endMs,
    classificacao: metricas.classification,
    foiFundido: metricas.wasMerged ? "1" : "0",
    channelCountReal: metricas.channelCountReal,
    speakerEstimado: metricas.speaker.spk,
    mimeType: metricas.mimeType
  });

  const textoWebhook = prepararTextoTranscricaoFinal(resposta.texto || "").trim();
  const textoExibicao = textoWebhook || "[sem transcricao retornada]";
  const speakerFinal = textoWebhook ? metricas.speaker.spk : `${metricas.speaker.spk || "?"}`;

  const segmentoRender = {
    id: segmento.id,
    spk: speakerFinal,
    conf: metricas.speaker.conf,
    delta: metricas.speaker.delta,
    ch: metricas.averageFeatures.ch,
    vol: metricas.averageFeatures.vol,
    pit: metricas.averageFeatures.pit,
    zcr: metricas.averageFeatures.zcr,
    cent: metricas.averageFeatures.cent,
    texto: textoExibicao,
    inicioMs: segmento.startMs,
    fimMs: segmento.endMs,
    motivo: segmento.reason,
    classificacao: metricas.classification,
    fundido: metricas.wasMerged,
    blobSize: metricas.blobSize,
    mimeType: metricas.mimeType,
    mergedIds: segmento.mergedIds || []
  };

  state.segmentosMarcados.push(segmentoRender);
  appendSegmentoMarcado(segmentoRender);
  if (textoWebhook) {
    adicionarTrechoConsolidado(textoWebhook, metricas.wasMerged ? "webhook_fundido" : "webhook");
  }

  setStatus(`Status: segmento enviado (${metricas.classification}, motivo=${segmento.reason}).`);
  debug("Blob enviado ao webhook.", {
    id: segmento.id,
    classificacao: metricas.classification,
    blobType: metricas.mimeType || "(vazio)",
    blobSize: metricas.blobSize,
    speaker: metricas.speaker.spk,
    resposta: resumirRespostaWebhook(resposta.bruto),
    texto: textoWebhook || "(sem texto)"
  });
}

function resumirRespostaWebhook(payload) {
  const texto = extrairTextoDaRespostaWebhook(payload);
  if (textoTemConteudo(texto)) {
    return texto.slice(0, 120);
  }
  try {
    return JSON.stringify(payload).slice(0, 120);
  } catch (_error) {
    return String(payload).slice(0, 120);
  }
}

function appendSegmentoMarcado(seg) {
  const linha = document.createElement("div");
  linha.className = "linha-segmento";

  if (state.modoDebugAtivo) {
    linha.textContent =
      `[${formatTimeMs(seg.inicioMs)}-${formatTimeMs(seg.fimMs)}] ` +
      `(spk=${seg.spk}, conf=${formatNumber(seg.conf)}, delta=${formatNumber(seg.delta)}, ` +
      `cls=${seg.classificacao}, motivo=${seg.motivo}, fundido=${seg.fundido ? "sim" : "nao"}, ` +
      `blob=${seg.blobSize}, mime=${seg.mimeType || "(vazio)"}) ${seg.texto}`;
  } else {
    linha.textContent = `(${seg.spk}, conf=${formatNumber(seg.conf)}, delta=${formatNumber(seg.delta)}) ${seg.texto}`;
  }

  els.resultadoSegmentos.appendChild(linha);
  els.resultadoSegmentos.scrollTop = els.resultadoSegmentos.scrollHeight;
}

function renderizarSegmentosMarcados() {
  els.resultadoSegmentos.innerHTML = "";
  for (const seg of state.segmentosMarcados) {
    appendSegmentoMarcado(seg);
  }
}

function adicionarTrechoConsolidado(texto, origem = "webhook") {
  const trecho = prepararTextoTranscricaoFinal(texto).trim();
  if (!trecho) {
    return;
  }
  state.transcricaoFinalPartes.push(trecho);
  els.transcricaoFinal.textContent = state.transcricaoFinalPartes.join(" ").trim();
  debug("Trecho consolidado.", {
    origem,
    trecho: trecho.slice(0, 120)
  });
}

async function iniciarEntrevista() {
  if (state.interview.active) {
    return;
  }
  if (!calibracoesConcluidas()) {
    setStatus("Status: calibre Individuo 1 e Individuo 2 antes de iniciar.");
    return;
  }

  try {
    resetarSaidaEntrevista();
    setStatus("Status: preparando entrevista...");
    const rawStream = await solicitarMicrofoneBruto();
    await setupAudioEngine({ rawStream, mode: "entrevista" });

    state.interview.active = true;
    state.interview.finalizing = false;
    state.interview.uploadQueue = Promise.resolve();
    iniciarSegmentoLogico(performance.now());
    startContinuousRecorder();
    startSegmentMonitor();
    updateControls();

    debug("Entrevista iniciada.", {
      stereoReal: state.audioInfo.hasRealStereo,
      channelCountReal: state.audioInfo.channelCountReal || "desconhecido",
      featuresAtivas: state.activeFeatureKeys.join(", "),
      bitrate: RECORDER_AUDIO_BITS_PER_SECOND,
      timeslice: RECORDER_TIMESLICE_MS
    });
    setStatus("Status: entrevista ativa (gravacao continua + cortes por tempo e silencio).");
  } catch (error) {
    state.interview.active = false;
    updateControls();
    await teardownAudioEngine();
    setStatus("Status: nao foi possivel iniciar a entrevista.");
    debug("Erro ao iniciar entrevista.", {
      erro: error.message || String(error)
    });
  }
}

async function finalizarEntrevista() {
  if (!state.interview.active && !state.interview.finalizing) {
    return;
  }

  state.interview.finalizing = true;
  state.interview.active = false;
  updateControls();
  setStatus("Status: finalizando entrevista...");
  stopSegmentMonitor();

  try {
    await stopContinuousRecorder();
    closeLogicalSegment("finalizar", { force: true, final: true });
    await state.interview.uploadQueue;
    await flushPendenteFinal();
    setStatus("Status: entrevista finalizada.");
    debug("Entrevista finalizada com flush completo.");
  } catch (error) {
    setStatus("Status: entrevista finalizada com avisos.");
    debug("Erro ao finalizar entrevista.", {
      erro: error.message || String(error)
    });
  } finally {
    stopSegmentMonitor();
    await teardownAudioEngine();
    resetInterviewRuntime();
    updateControls();
  }
}

function montarPromptComBlocos(template, transcricaoFinal, segmentosMarcados) {
  const base = textoTemConteudo(template) ? template : PROMPT_PADRAO;
  let promptFinal = base
    .replaceAll("{{TRANSCRICAO_FINAL}}", transcricaoFinal || "")
    .replaceAll("{{SEGMENTOS_MARCADOS}}", segmentosMarcados || "");

  if (!base.includes("{{TRANSCRICAO_FINAL}}")) {
    promptFinal += `\n\nBLOCO 1 - TRANSCRICAO FINAL:\n${transcricaoFinal || ""}`;
  }
  if (!base.includes("{{SEGMENTOS_MARCADOS}}")) {
    promptFinal += `\n\nBLOCO 2 - SEGMENTOS MARCADOS:\n${segmentosMarcados || ""}`;
  }
  return promptFinal;
}

function carregarPromptIA() {
  try {
    const salvo = localStorage.getItem(PROMPT_IA_STORAGE_KEY);
    els.campoPromptIA.value = textoTemConteudo(salvo) ? salvo : PROMPT_PADRAO;
  } catch (error) {
    els.campoPromptIA.value = PROMPT_PADRAO;
    debug("Falha ao ler prompt salvo.", {
      erro: error.message || String(error)
    });
  }
}

function salvarPromptIA() {
  try {
    localStorage.setItem(PROMPT_IA_STORAGE_KEY, els.campoPromptIA.value || PROMPT_PADRAO);
    setStatus("Status: prompt salvo.");
    debug("Prompt da IA salvo no localStorage.");
  } catch (error) {
    setStatus("Status: nao foi possivel salvar o prompt.");
    debug("Erro ao salvar prompt da IA.", {
      erro: error.message || String(error)
    });
  }
}

async function enviarParaIA() {
  const transcricaoFinal = (els.transcricaoFinal.textContent || "").trim();
  const segmentosMarcados = (els.resultadoSegmentos.innerText || "").trim();
  const prompt = montarPromptComBlocos(els.campoPromptIA.value, transcricaoFinal, segmentosMarcados);
  try {
    await copiarTextoParaClipboard(prompt);
    setStatus("Status: prompt copiado para a area de transferencia.");
  } catch (error) {
    setStatus("Status: nao foi possivel copiar automaticamente; prompt registrado no debug.");
    debug("Falha ao copiar prompt.", {
      erro: error.message || String(error)
    });
  }
  debug("Prompt final gerado para IA.", { prompt });
}

async function copiarTextoParaClipboard(texto) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(texto);
    return;
  }
  copiarTextoFallback(texto);
}

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

function extrairTextoDaRespostaWebhook(payload) {
  if (payload == null) {
    return "";
  }
  if (typeof payload === "string") {
    return payload.trim();
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const texto = extrairTextoDaRespostaWebhook(item);
      if (texto) {
        return texto;
      }
    }
    return "";
  }

  const candidatos = [
    "text",
    "texto",
    "transcript",
    "transcricao",
    "transcription",
    "output",
    "message",
    "result"
  ];

  for (const chave of candidatos) {
    if (payload[chave] != null) {
      const texto = extrairTextoDaRespostaWebhook(payload[chave]);
      if (texto) {
        return texto;
      }
    }
  }

  if (payload.data != null) {
    const texto = extrairTextoDaRespostaWebhook(payload.data);
    if (texto) {
      return texto;
    }
  }

  return "";
}

async function enviarBlobParaWebhook(audioBlob, metadados = {}) {
  const formData = new FormData();
  formData.append("audio", audioBlob, nomeArquivo(audioBlob.type || metadados.mimeType || ""));
  formData.append("origem", "mobile-v2-html");
  formData.append("duracao_ms", String(Math.max(0, Math.round(metadados.duracaoMs || 0))));
  formData.append("contexto", metadados.contexto || "entrevista");
  if (metadados.idioma) {
    formData.append("idioma", String(metadados.idioma));
  }
  if (metadados.chunkInicioMs != null) {
    formData.append("chunk_inicio_ms", String(Math.round(metadados.chunkInicioMs)));
  }
  if (metadados.chunkFimMs != null) {
    formData.append("chunk_fim_ms", String(Math.round(metadados.chunkFimMs)));
  }
  if (metadados.classificacao) {
    formData.append("segmento_classificacao", String(metadados.classificacao));
  }
  if (metadados.foiFundido != null) {
    formData.append("segmento_fundido", String(metadados.foiFundido));
  }
  if (metadados.channelCountReal != null) {
    formData.append("channel_count_real", String(metadados.channelCountReal));
  }
  if (metadados.speakerEstimado) {
    formData.append("speaker_estimado", String(metadados.speakerEstimado));
  }
  if (metadados.mimeType) {
    formData.append("mime_type_local", String(metadados.mimeType));
  }

  const auth = "Basic " + btoa(`${N8N_BASIC_USER}:${N8N_BASIC_PASS}`);
  const response = await fetch(N8N_URL, {
    method: "POST",
    headers: {
      Authorization: auth
    },
    body: formData
  });

  const rawText = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (_error) {
    parsed = rawText;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }

  return {
    texto: prepararTextoTranscricaoFinal(extrairTextoDaRespostaWebhook(parsed)).trim(),
    bruto: parsed
  };
}
