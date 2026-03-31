const CALIBRACAO_MS = 4000;
const FEATURE_INTERVAL_MS = 50;
const JANELA_SEGMENTO_MS = 3000;
const RETENCAO_TIMELINE_MS = 30000;
const INTERIM_IDLE_FLUSH_MS = 1800;
const CENTROID_MIN_HZ = 80;
const CENTROID_MAX_HZ = 4000;
const PESO_MINIMO_DINAMICO = 0.03;
const EPSILON_PESO = 1e-6;
const CALIBRACAO_VOL_MIN = 0.008;
const SEGMENTO_VOL_MIN = 0.012;
const MAX_SOBREPOSICAO_CHARS = 320;
const INTERIM_LOG_THROTTLE_MS = 700;
const TRACE_LOG_THROTTLE_MS = 500;
const FEATURE_KEYS = ["ch", "vol", "pit", "zcr", "cent"];

const els = {
  btnCalibrarIndividuo1: document.getElementById("btnCalibrarIndividuo1"),
  btnCalibrarIndividuo2: document.getElementById("btnCalibrarIndividuo2"),
  btnIniciar: document.getElementById("btnIniciar"),
  btnFinalizar: document.getElementById("btnFinalizar"),
  btnEnviar: document.getElementById("btnEnviar"),
  status: document.getElementById("status"),
  debug: document.getElementById("debug"),
  resultadoSegmentos: document.getElementById("resultadoSegmentos"),
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
  interimAtual: "",
  ultimoInterimUpdateMs: 0,
  interimWatchdogTimer: null,
  ultimoInterimLogMs: 0,
  traceLastByKey: {},
  aguardandoFlushFinal: false,
  finalizarRecognitionResolve: null,
  finalizarRecognitionTimer: null
};

boot();

// Inicializa eventos de UI e estado base da aplicação.
function boot() {
  els.btnCalibrarIndividuo1.addEventListener("click", () => calibrar("Individuo 1"));
  els.btnCalibrarIndividuo2.addEventListener("click", () => calibrar("Individuo 2"));
  els.btnIniciar.addEventListener("click", iniciarEntrevista);
  els.btnFinalizar.addEventListener("click", finalizarEntrevista);
  els.btnEnviar.addEventListener("click", enviarParaIA);
  iniciarWatchdogInterim();
  setStatus("Status: pronto para calibrar.");
  debug("Sistema iniciado.");
}

// Atualiza o texto de status principal na interface.
function setStatus(texto) {
  els.status.textContent = texto;
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
async function setupAudioEngine() {
  if (state.audioContext && state.stream && state.featureTimer) {
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 2,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  const audioContext = new AudioContext();
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
  debug("Captura de áudio inicializada.");
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

// Executa calibração de um participante (áudio + extração de nome + assinatura).
async function calibrar(nome) {
  try {
    if (state.entrevistaAtiva) {
      setStatus("Status: finalize a entrevista antes de calibrar.");
      return;
    }
    if (state.calibrando) {
      setStatus("Status: já existe calibração em andamento.");
      return;
    }

    await setupAudioEngine();
    state.calibrando = nome;
    state.calibracaoBuffer = [];
    travarControles(true);
    setStatus(`Status: calibrando ${nome} por 4 segundos...`);
    debug(`Calibração de ${nome} iniciada.`);
    const promessaTranscricao = capturarTranscricaoCalibracao(CALIBRACAO_MS);

    window.setTimeout(async () => {
      try {
        const framesBrutos = state.calibracaoBuffer.slice();
        const framesVoz = filtrarFramesCalibracao(framesBrutos);
        const baseCalibracao = framesVoz.length >= 10 ? framesVoz : framesBrutos;
        const assinatura = mediaEdesvioFeatures(baseCalibracao);
        const textoCalibracao = await promessaTranscricao;
        const nomeExtraido = extrairNomeDaCalibracao(textoCalibracao);
        state.calibrando = null;
        state.calibracaoBuffer = [];
        travarControles(false);

        if (!assinatura) {
          setStatus(`Status: falha na calibração de ${nome}. Tente novamente.`);
          debug(`Calibração de ${nome} sem dados suficientes.`);
          return;
        }

        if (nome === "Individuo 1") {
          state.assinaturaIndividuo1 = assinatura;
          if (nomeExtraido) {
            state.nomeIndividuo1 = nomeExtraido;
          }
        } else {
          state.assinaturaIndividuo2 = assinatura;
          if (nomeExtraido) {
            state.nomeIndividuo2 = nomeExtraido;
          }
        }

        const rotuloAtual = nome === "Individuo 1" ? state.nomeIndividuo1 : state.nomeIndividuo2;
        setStatus(`Status: calibração de ${nome} concluída (${rotuloAtual}).`);
        debug(`Fala calibração ${nome}: "${textoCalibracao || "sem transcrição"}"`);
        debug(`Frames calibração ${nome}: brutos=${framesBrutos.length}, voz=${framesVoz.length}, usados=${baseCalibracao.length}`);
        debug(`Assinatura ${rotuloAtual} medias: ${formatFeatures(assinatura.medias)}`);
        debug(`Assinatura ${rotuloAtual} desvios: ${formatFeatures(assinatura.desvios)}`);
        // Recalcula pesos somente após concluir/salvar a calibração atual.
        atualizarPesosAposCalibracao();
      } finally {
        await teardownAudioEngine();
      }
    }, CALIBRACAO_MS);
  } catch (error) {
    state.calibrando = null;
    state.calibracaoBuffer = [];
    travarControles(false);
    setStatus("Status: erro ao acessar microfone para calibração.");
    debug(`Erro de calibração: ${error.message || String(error)}`);
  }
}

// Habilita/desabilita botões conforme estado de calibração/entrevista.
function travarControles(calibrando) {
  els.btnCalibrarIndividuo1.disabled = calibrando;
  els.btnCalibrarIndividuo2.disabled = calibrando;
  els.btnIniciar.disabled = calibrando || state.entrevistaAtiva;
  els.btnFinalizar.disabled = !state.entrevistaAtiva;
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
  if (!lista || !lista.length) {
    return [];
  }
  return lista.filter((f) => {
    const volOk = (f.vol || 0) >= CALIBRACAO_VOL_MIN;
    const vozProvavel = (f.pit || 0) > 0 || (f.zcr || 0) > 0.03;
    return volOk && vozProvavel;
  });
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
  try {
    await setupAudioEngine();
    state.timeline = [];
    state.segmentosMarcados = [];
    state.transcricaoFinalPartes = [];
    state.interimAtual = "";
    state.ultimoInterimUpdateMs = 0;
    state.aguardandoFlushFinal = false;
    state.finalizarRecognitionResolve = null;
    if (state.finalizarRecognitionTimer) {
      window.clearTimeout(state.finalizarRecognitionTimer);
      state.finalizarRecognitionTimer = null;
    }
    els.resultadoSegmentos.textContent = "";
    atualizarTranscricaoFinalUI();

    iniciarRecognition();
    state.entrevistaAtiva = true;
    els.btnIniciar.disabled = true;
    els.btnFinalizar.disabled = false;
    setStatus("Status: entrevista ativa (captura + transcrição contínua).");
    debug("Entrevista iniciada.");
  } catch (error) {
    setStatus("Status: não foi possível iniciar a entrevista.");
    debug(`Erro ao iniciar entrevista: ${error.message || String(error)}`);
  }
}

// Configura e inicia SpeechRecognition com tratamento de eventos.
function iniciarRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error("Web Speech API não disponível no navegador.");
  }

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
      const texto = (resultado[0] && resultado[0].transcript ? resultado[0].transcript : "").trim();
      if (!texto) {
        continue;
      }
      if (resultado.isFinal) {
        try {
          const t0 = performance.now();
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
          adicionarTrechoConsolidado(texto, "final");
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
        if (state.interimAtual !== texto) {
          state.interimAtual = texto;
          state.ultimoInterimUpdateMs = Date.now();
          debug(`interim atualizado: ${texto}`);
          atualizarTranscricaoFinalUI();
        }
      }
    }
  };

  recognition.onerror = (event) => {
    trace("recognition.onerror", { error: event.error || "desconhecido" });
    debug(`SpeechRecognition erro: ${event.error || "desconhecido"}`);
  };

  recognition.onend = () => {
    trace("recognition.onend", {
      entrevistaAtiva: state.entrevistaAtiva,
      aguardandoFlushFinal: state.aguardandoFlushFinal
    });
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
        recognition.start();
        state.recognitionRunning = true;
        trace("recognition.restart.ok");
      } catch (e) {
        trace("recognition.restart.fail", { erro: e.message || String(e) });
        debug(`Falha ao reiniciar recognition: ${e.message || String(e)}`);
      }
    }
  };

  recognition.start();
  state.recognition = recognition;
  state.recognitionRunning = true;
}

// Gera segmento classificado a partir de texto final e janela acústica recente.
function fecharSegmento(textoFinal) {
  trace("fecharSegmento.start", { timeline: state.timeline.length, textoLen: (textoFinal || "").length }, "fechar");
  const agora = performance.now();
  const inicioJanela = agora - JANELA_SEGMENTO_MS;
  const janela = state.timeline.filter((f) => f.time >= inicioJanela && f.time <= agora);
  const subsegmentos = quebrarSegmentoPorTrocaDeSpeaker(textoFinal, janela);
  if (subsegmentos.length) {
    for (let i = 0; i < subsegmentos.length; i += 1) {
      state.segmentosMarcados.push(subsegmentos[i]);
      appendSegmentoMarcado(subsegmentos[i]);
    }
    return;
  }

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
  linha.textContent =
    `{spk=${seg.spk}, conf=${seg.conf.toFixed(2)}, delta=${seg.delta.toFixed(2)}, ` +
    `ch=${seg.ch.toFixed(2)}, vol=${seg.vol.toFixed(2)}, pit=${seg.pit.toFixed(2)}, ` +
    `zcr=${seg.zcr.toFixed(2)}, cent=${seg.cent.toFixed(2)}} ${seg.texto}`;
  els.resultadoSegmentos.appendChild(linha);
  els.resultadoSegmentos.scrollTop = els.resultadoSegmentos.scrollHeight;
}

// Finaliza entrevista com flush de recognition/interim e teardown de áudio.
async function finalizarEntrevista() {
  if (!state.entrevistaAtiva) {
    return;
  }

  state.entrevistaAtiva = false;
  els.btnIniciar.disabled = true;
  els.btnFinalizar.disabled = true;

  await aguardarParadaRecognition();
  flushInterimFinalSeNecessario();

  await teardownAudioEngine();
  state.recognitionRunning = false;
  els.btnIniciar.disabled = false;
  setStatus("Status: entrevista finalizada.");
  debug("Entrevista finalizada e recursos liberados.");
}

// Monta prompt completo e copia para clipboard para uso em IA.
async function enviarParaIA() {
  const promptMontado = montarPromptParaIA();
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

// Atualiza coluna de transcrição corrida (consolidado + interim em processamento).
function atualizarTranscricaoFinalUI() {
  const consolidado = obterTranscricaoFinalConsolidada();
  const interim = (state.interimAtual || "").trim();
  const textoVisivel = interim
    ? `${consolidado}${consolidado ? "\n" : ""}[em processamento] ${interim}`
    : consolidado;

  els.transcricaoFinal.innerText = textoVisivel;
  els.transcricaoFinal.scrollTop = els.transcricaoFinal.scrollHeight;
}

// Retorna o texto consolidado final da transcrição corrida.
function obterTranscricaoFinalConsolidada() {
  return state.transcricaoFinalPartes.join(" ").trim();
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

// Faz flush do interim pendente para não perder fala no encerramento.
function flushInterimFinalSeNecessario() {
  const trecho = (state.interimAtual || "").trim();
  if (!trecho) {
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
  adicionarTrechoConsolidado(trecho, "interim_flush");
  state.interimAtual = "";
  state.ultimoInterimUpdateMs = 0;
  debug(`flush final aplicado: ${trecho}`);
  atualizarTranscricaoFinalUI();
  console.log("[ovl] flushInterim done: partes=", state.transcricaoFinalPartes.length);
  trace("flushInterim.done", {
    partesDepois: state.transcricaoFinalPartes.length,
    consolidadoDepoisLen: obterTranscricaoFinalConsolidada().length
  });
}

// Monitor de interim parado para flush preventivo durante entrevista ativa.
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
    debug(`interim parado por ${paradoMs}ms, aplicando flush preventivo.`);
    flushInterimFinalSeNecessario();
  }, 450);
}

// Consolida novo trecho na transcrição final com estratégia de merge por sobreposição.
function adicionarTrechoConsolidado(texto, origem = "desconhecida") {
  const trecho = (texto || "").trim();
  if (!trecho) {
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
        features: [atual.feature]
      });
    } else {
      ultimo.count += 1;
      ultimo.deltaSum += atual.delta;
      ultimo.features.push(atual.feature);
    }
  }

  const runsFiltrados = runs.filter((r) => r.count >= 3);
  if (runsFiltrados.length < 2) {
    return [];
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
function capturarTranscricaoCalibracao(duracaoMs) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    debug("Web Speech API indisponível para extrair nome na calibração.");
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    const recognition = new SpeechRecognition();
    let textoFinal = "";
    let textoInterim = "";
    let finalizado = false;

    const finalizar = () => {
      if (finalizado) {
        return;
      }
      finalizado = true;
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

    recognition.onerror = () => {
      finalizar();
    };

    recognition.onend = () => {
      finalizar();
    };

    try {
      recognition.start();
    } catch (error) {
      debug(`Falha ao iniciar SpeechRecognition na calibração: ${error.message || String(error)}`);
      finalizar();
      return;
    }

    window.setTimeout(() => {
      try {
        recognition.stop();
      } catch (error) {
        debug(`Falha ao parar SpeechRecognition na calibração: ${error.message || String(error)}`);
        finalizar();
      }
      window.setTimeout(finalizar, 350);
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
