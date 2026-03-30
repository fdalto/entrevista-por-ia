const CALIBRACAO_MS = 4000;
const FEATURE_INTERVAL_MS = 50;
const JANELA_SEGMENTO_MS = 3000;
const RETENCAO_TIMELINE_MS = 30000;

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
  featureTimer: null,
  timeline: [],
  ultimoFeature: null,
  recognition: null,
  recognitionRunning: false,
  entrevistaAtiva: false,
  assinaturaIndividuo1: null,
  assinaturaIndividuo2: null,
  nomeIndividuo1: "Individuo 1",
  nomeIndividuo2: "Individuo 2",
  calibrando: null,
  calibracaoBuffer: [],
  segmentosMarcados: [],
  transcricaoFinalCorrida: ""
};

boot();

function boot() {
  els.btnCalibrarIndividuo1.addEventListener("click", () => calibrar("Individuo 1"));
  els.btnCalibrarIndividuo2.addEventListener("click", () => calibrar("Individuo 2"));
  els.btnIniciar.addEventListener("click", iniciarEntrevista);
  els.btnFinalizar.addEventListener("click", finalizarEntrevista);
  els.btnEnviar.addEventListener("click", enviarParaIA);
  setStatus("Status: pronto para calibrar.");
  debug("Sistema iniciado.");
}

function setStatus(texto) {
  els.status.textContent = texto;
}

function debug(texto) {
  const linha = `[${new Date().toLocaleTimeString()}] ${texto}\n`;
  els.debug.textContent = (els.debug.textContent + linha).slice(-8000);
  els.debug.scrollTop = els.debug.scrollHeight;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist(a, b) {
  return Math.sqrt(
    (a.ch - b.ch) ** 2 +
    (a.vol - b.vol) ** 2 +
    (a.pit - b.pit) ** 2
  );
}

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
  startFeatureLoop();
  debug("Captura de áudio inicializada.");
}

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
  state.featureTimer = null;
}

function startFeatureLoop() {
  if (state.featureTimer) {
    return;
  }
  state.featureTimer = window.setInterval(capturarFeature, FEATURE_INTERVAL_MS);
}

function stopFeatureLoop() {
  if (!state.featureTimer) {
    return;
  }
  window.clearInterval(state.featureTimer);
  state.featureTimer = null;
}

function capturarFeature() {
  if (!state.analyserL || !state.analyserR) {
    return;
  }

  state.analyserL.getFloatTimeDomainData(state.floatL);
  state.analyserR.getFloatTimeDomainData(state.floatR);

  const rmsL = rms(state.floatL);
  const rmsR = rms(state.floatR);
  const vol = clamp((rmsL + rmsR) / 2, 0, 1);
  const ch = clamp((rmsL - rmsR) / (rmsL + rmsR + 1e-6), -1, 1);
  const pit = detectarPitchNormalizado(state.floatL, state.floatR, state.audioContext.sampleRate);

  const feature = {
    time: performance.now(),
    ch,
    vol,
    pit
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

function rms(buffer) {
  let soma = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    soma += buffer[i] * buffer[i];
  }
  return Math.sqrt(soma / buffer.length);
}

function detectarPitchNormalizado(bufferL, bufferR, sampleRate) {
  const mix = new Float32Array(bufferL.length);
  for (let i = 0; i < bufferL.length; i += 1) {
    mix[i] = (bufferL[i] + bufferR[i]) * 0.5;
  }
  const freq = autoCorrelacaoPitch(mix, sampleRate);
  if (!freq) {
    return 0;
  }
  const minHz = 80;
  const maxHz = 350;
  const norm = (freq - minHz) / (maxHz - minHz);
  return clamp(norm, 0, 1);
}

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
        const assinatura = mediaFeatures(state.calibracaoBuffer);
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
        debug(`Assinatura ${rotuloAtual}: ${formatFeatures(assinatura)}`);
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

function travarControles(calibrando) {
  els.btnCalibrarIndividuo1.disabled = calibrando;
  els.btnCalibrarIndividuo2.disabled = calibrando;
  els.btnIniciar.disabled = calibrando || state.entrevistaAtiva;
  els.btnFinalizar.disabled = !state.entrevistaAtiva;
}

function mediaFeatures(lista) {
  if (!lista || !lista.length) {
    return null;
  }
  let ch = 0;
  let vol = 0;
  let pit = 0;
  for (let i = 0; i < lista.length; i += 1) {
    ch += lista[i].ch;
    vol += lista[i].vol;
    pit += lista[i].pit;
  }
  return {
    ch: ch / lista.length,
    vol: vol / lista.length,
    pit: pit / lista.length
  };
}

function formatFeatures(f) {
  return `ch=${f.ch.toFixed(2)}, vol=${f.vol.toFixed(2)}, pit=${f.pit.toFixed(2)}`;
}

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
    state.transcricaoFinalCorrida = "";
    els.resultadoSegmentos.textContent = "";
    els.transcricaoFinal.textContent = "";

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
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const resultado = event.results[i];
      const texto = (resultado[0] && resultado[0].transcript ? resultado[0].transcript : "").trim();
      if (!texto) {
        continue;
      }
      if (resultado.isFinal) {
        fecharSegmento(texto);
        appendTranscricaoFinal(texto);
      }
    }
  };

  recognition.onerror = (event) => {
    debug(`SpeechRecognition erro: ${event.error || "desconhecido"}`);
  };

  recognition.onend = () => {
    state.recognitionRunning = false;
    if (state.entrevistaAtiva) {
      try {
        recognition.start();
        state.recognitionRunning = true;
      } catch (e) {
        debug(`Falha ao reiniciar recognition: ${e.message || String(e)}`);
      }
    }
  };

  recognition.start();
  state.recognition = recognition;
  state.recognitionRunning = true;
}

function fecharSegmento(textoFinal) {
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

  const medias = mediaFeatures(janela) || state.ultimoFeature || { ch: 0, vol: 0, pit: 0 };
  const classif = classificarSegmento(medias);
  const unico = {
    spk: classif.spk,
    conf: classif.conf,
    delta: classif.delta,
    ch: medias.ch,
    vol: medias.vol,
    pit: medias.pit,
    texto: textoFinal
  };
  state.segmentosMarcados.push(unico);
  appendSegmentoMarcado(unico);
}

function classificarSegmento(features) {
  const assinaturaIndividuo1 = state.assinaturaIndividuo1;
  const assinaturaIndividuo2 = state.assinaturaIndividuo2;

  if (!assinaturaIndividuo1 || !assinaturaIndividuo2) {
    return { spk: "?", conf: 0, delta: 0 };
  }

  const dIndividuo1 = dist(features, assinaturaIndividuo1);
  const dIndividuo2 = dist(features, assinaturaIndividuo2);
  const delta = Math.abs(dIndividuo1 - dIndividuo2);
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

function appendSegmentoMarcado(seg) {
  const linha = document.createElement("div");
  linha.className = "linha-segmento";
  linha.textContent =
    `{spk=${seg.spk}, conf=${seg.conf.toFixed(2)}, delta=${seg.delta.toFixed(2)}, ` +
    `ch=${seg.ch.toFixed(2)}, vol=${seg.vol.toFixed(2)}, pit=${seg.pit.toFixed(2)}} ${seg.texto}`;
  els.resultadoSegmentos.appendChild(linha);
  els.resultadoSegmentos.scrollTop = els.resultadoSegmentos.scrollHeight;
}

async function finalizarEntrevista() {
  if (!state.entrevistaAtiva) {
    return;
  }

  state.entrevistaAtiva = false;
  els.btnIniciar.disabled = false;
  els.btnFinalizar.disabled = true;

  if (state.recognition && state.recognitionRunning) {
    try {
      state.recognition.stop();
    } catch (e) {
      debug(`Aviso ao parar recognition: ${e.message || String(e)}`);
    }
  }

  await teardownAudioEngine();
  state.recognitionRunning = false;
  setStatus("Status: entrevista finalizada.");
  debug("Entrevista finalizada e recursos liberados.");
}

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

function appendTranscricaoFinal(texto) {
  const trecho = (texto || "").trim();
  if (!trecho) {
    return;
  }
  const separador = state.transcricaoFinalCorrida ? " " : "";
  state.transcricaoFinalCorrida = `${state.transcricaoFinalCorrida}${separador}${trecho}`.trim();
  els.transcricaoFinal.textContent = state.transcricaoFinalCorrida;
  els.transcricaoFinal.scrollTop = els.transcricaoFinal.scrollHeight;
}

function montarPromptParaIA() {
  const transcricaoFinal = (els.transcricaoFinal.innerText || "").trim();
  const segmentosMarcados = (els.resultadoSegmentos.innerText || "").trim();

  return `Você receberá dois blocos de texto da mesma conversa.

BLOCO 1 — TRANSCRIÇÃO CORRIDA FINAL:
Este bloco contém a transcrição corrida formada apenas pelos trechos finais reconhecidos pelo mecanismo de fala. Em geral, ele preserva melhor as palavras reconhecidas, mas não identifica com segurança quem falou cada trecho.

BLOCO 2 — SEGMENTOS MARCADOS:
Este bloco contém segmentos menores com tentativa automática de identificar o interlocutor. Cada linha vem no formato:
{spk=..., conf=..., delta=..., ch=..., vol=..., pit=...} texto

Interpretação:

* spk: sugestão automática de speaker. Pode vir como nome, nome com interrogação, ou apenas "?".
* conf: confiança da classificação local.
* delta: diferença de distância entre os dois perfis calibrados. Quanto maior, mais forte a distinção.
* ch, vol, pit: features acústicas auxiliares.
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
    const medias = mediaFeatures(run.features) || state.ultimoFeature || { ch: 0, vol: 0, pit: 0 };
    const nome = run.label === 1 ? state.nomeIndividuo1 : state.nomeIndividuo2;
    const conf = clamp((run.deltaSum / run.count) / 0.8, 0, 1);

    segmentos.push({
      spk: nome,
      conf,
      delta: run.deltaSum / run.count,
      ch: medias.ch,
      vol: medias.vol,
      pit: medias.pit,
      texto
    });
  }

  return segmentos;
}

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
