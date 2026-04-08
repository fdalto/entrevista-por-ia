let ctx, analyser, freqData, timeData, source, streamRef;
let recording = false;
let processingTimer = null;
let rafId = null;

const recordBtn = document.getElementById("recordBtn");
const cutEl = document.getElementById("cut");
const switchEl = document.getElementById("switch");
const barsEl = document.getElementById("bars");
const logEl = document.getElementById("log");
const canvas = document.getElementById("scope");
const cctx = canvas.getContext("2d");

const BAR_NAMES = ["VOLx20", "LOW", "MOVE", "CENT", "SPEECH"];

// ===== Configuração =====
const FRAME_MS = 50;                 // bloco básico
const SMOOTH_N = 5;                  // média móvel mínima = 3 blocos = 150 ms
const HISTORY_MAX = 120;             // histórico total
const CUT_SUSTAIN_BLOCKS = 6;        // 6 blocos suavizados = ~300 ms
const SWITCH_SUSTAIN_BLOCKS = 4;     // ~200 ms de mudança sustentada
const CUT_FLASH_MS = 300;
const SWITCH_FLASH_MS = 300;

const SPEECH_ON_THRESHOLD = 38;
const SPEECH_OFF_THRESHOLD = 24;

// ===== Estado =====
let rawFrames = [];
let smoothFrames = [];
let prevSpectrum = null;
let lastCutFlashAt = 0;
let lastSwitchFlashAt = 0;

// ===== UI =====
function createBars() {
  BAR_NAMES.forEach((name) => {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.alignItems = "center";
    wrap.style.gap = "8px";

    const label = document.createElement("div");
    label.textContent = name;
    label.style.fontSize = "12px";
    label.style.fontWeight = "bold";

    const bar = document.createElement("div");
    bar.className = "bar";

    const fill = document.createElement("div");
    fill.className = "fill";
    fill.style.height = "10%";

    bar.appendChild(fill);
    wrap.appendChild(label);
    wrap.appendChild(bar);
    barsEl.appendChild(wrap);
  });
}
createBars();

// ===== Controle =====
recordBtn.onclick = async () => {
  if (!recording) {
    await startRecording();
  } else {
    stopRecording();
  }
};

async function startRecording() {
  try {
    streamRef = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true
      }
    });

    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    source = ctx.createMediaStreamSource(streamRef);
    source.connect(analyser);

    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.15;

    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);

    recording = true;
    recordBtn.innerText = "PARAR";

    rawFrames = [];
    smoothFrames = [];
    prevSpectrum = null;
    lastCutFlashAt = 0;
    lastSwitchFlashAt = 0;

    drawScope();
    startProcessing();
  } catch (err) {
    console.error(err);
    alert("Não foi possível acessar o microfone.");
  }
}

function stopRecording() {
  recording = false;
  recordBtn.innerText = "GRAVAR";

  if (processingTimer) {
    clearInterval(processingTimer);
    processingTimer = null;
  }

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (streamRef) {
    streamRef.getTracks().forEach(t => t.stop());
    streamRef = null;
  }

  if (ctx) {
    ctx.close();
    ctx = null;
  }

  clearIndicators();
}

function clearIndicators() {
  cutEl.classList.remove("active");
  switchEl.classList.remove("active");
}

// ===== Loop visual =====
function drawScope() {
  if (!recording || !analyser) return;

  analyser.getByteFrequencyData(freqData);

  cctx.clearRect(0, 0, canvas.width, canvas.height);
  cctx.beginPath();

  for (let i = 0; i < freqData.length; i++) {
    const v = freqData[i] / 255;
    const x = (i / freqData.length) * canvas.width;
    const y = canvas.height - v * canvas.height;

    if (i === 0) cctx.moveTo(x, y);
    else cctx.lineTo(x, y);
  }

  cctx.stroke();
  rafId = requestAnimationFrame(drawScope);
}

// ===== Processamento =====
function startProcessing() {
  processingTimer = setInterval(() => {
    if (!recording || !analyser) return;

    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);

    const result = process50msFrame(freqData, timeData);

    if (result.smoothItem) {
      updateBars([
        result.smoothItem.volScore,
        result.smoothItem.lowBandScore,
        result.smoothItem.movementScore,
        result.smoothItem.centroidScore,
        result.smoothItem.speechScore
      ]);

      if (result.shouldCut) {
        throttledFlash(cutEl, CUT_FLASH_MS, "cut");
      }

      if (result.shouldSwitch) {
        throttledFlash(switchEl, SWITCH_FLASH_MS, "switch");
      }

      logEl.innerText = JSON.stringify({
        volX20: result.smoothItem.volScore.toFixed(1),
        low: result.smoothItem.lowBandScore.toFixed(1),
        move: result.smoothItem.movementScore.toFixed(1),
        cent: result.smoothItem.centroidScore.toFixed(1),
        speech: result.smoothItem.speechScore.toFixed(1),
        speechState: result.smoothItem.isSpeech ? "fala" : "nao_fala",
        recentSpeechAvg: result.debug.recentSpeechAvg.toFixed(1),
        prevSpeechAvg: result.debug.prevSpeechAvg.toFixed(1),
        recentLowAvg: result.debug.recentLowAvg.toFixed(1),
        prevLowAvg: result.debug.prevLowAvg.toFixed(1),
        recentMoveAvg: result.debug.recentMoveAvg.toFixed(1),
        speakerDeltaRecent: result.debug.speakerDeltaRecent.toFixed(1),
        shouldCut: result.shouldCut,
        shouldSwitch: result.shouldSwitch
      }, null, 2);
    }
  }, FRAME_MS);
}

function process50msFrame(currentFreq, currentTime) {
  const VOL_GAIN = 1;
  const LOW_GAIN = 1;
  const MOVE_GAIN = 5;
  const CENT_GAIN = 15;
  const ZCR_GAIN = 1;

  const rawVolNorm = avgAbsCentered(currentTime) / 128;
  const volScore = clamp((rawVolNorm * 15) * 100 * VOL_GAIN, 0, 100);

  const lowBand = bandEnergy(currentFreq, 0.00, 0.18);
  const lowBandScore = clamp((lowBand / 255) * 220 * LOW_GAIN, 0, 100);

  const movement = spectralMovement(currentFreq, prevSpectrum);
  const movementScore = clamp(movement * 2.2 * MOVE_GAIN, 0, 100);

  const centroidNorm = weightedIndex(currentFreq) / Math.max(1, currentFreq.length);
  const centroidScore = clamp(centroidNorm * 100 * CENT_GAIN, 0, 100);

  const zcr = zeroCrossingRate(currentTime);
  const zcrScore = clamp(zcr * 140 * ZCR_GAIN, 0, 100);

  // Heurística de fala
  const speechScore =
    volScore * 0.45 +
    lowBandScore * 0.28 +
    movementScore * 0.17 +
    centroidScore * 0.05 +
    zcrScore * 0.05;

  const rawItem = {
    volScore,
    lowBandScore,
    movementScore,
    centroidScore,
    zcrScore,
    speechScore,
    ts: performance.now()
  };

  rawFrames.push(rawItem);
  if (rawFrames.length > HISTORY_MAX) rawFrames.shift();

  prevSpectrum = new Uint8Array(currentFreq);

  // Ainda não temos 3 blocos para suavizar
  if (rawFrames.length < SMOOTH_N) {
    return {
      rawItem,
      smoothItem: null,
      shouldCut: false,
      shouldSwitch: false,
      debug: {
        recentSpeechAvg: 0,
        prevSpeechAvg: 0,
        recentLowAvg: 0,
        prevLowAvg: 0,
        recentMoveAvg: 0,
        speakerDeltaRecent: 0
      }
    };
  }

  // ----- Média móvel de 3 blocos -----
  const last3 = rawFrames.slice(-SMOOTH_N);
  const smoothItem = {
    volScore: avgKey(last3, "volScore"),
    lowBandScore: avgKey(last3, "lowBandScore"),
    movementScore: avgKey(last3, "movementScore"),
    centroidScore: avgKey(last3, "centroidScore"),
    zcrScore: avgKey(last3, "zcrScore"),
    speechScore: avgKey(last3, "speechScore"),
    ts: performance.now()
  };

  // Histerese simples de fala
  const prevSmooth = smoothFrames.length ? smoothFrames[smoothFrames.length - 1] : null;
  if (!prevSmooth) {
    smoothItem.isSpeech = smoothItem.speechScore >= SPEECH_ON_THRESHOLD;
  } else if (prevSmooth.isSpeech) {
    smoothItem.isSpeech = smoothItem.speechScore >= SPEECH_OFF_THRESHOLD;
  } else {
    smoothItem.isSpeech = smoothItem.speechScore >= SPEECH_ON_THRESHOLD;
  }

  smoothFrames.push(smoothItem);
  if (smoothFrames.length > HISTORY_MAX) smoothFrames.shift();

  let shouldCut = false;
  let shouldSwitch = false;

  let recentSpeechAvg = 0;
  let prevSpeechAvg = 0;
  let recentLowAvg = 0;
  let prevLowAvg = 0;
  let recentMoveAvg = 0;
  let speakerDeltaRecent = 0;

  // ===== Regra de corte: VAD heurístico + buffer temporal =====
  // Precisamos de fala antes e silêncio sustentado depois.
  if (smoothFrames.length >= CUT_SUSTAIN_BLOCKS * 2) {
    const recent = smoothFrames.slice(-CUT_SUSTAIN_BLOCKS); // últimos ~300 ms
    const previous = smoothFrames.slice(-(CUT_SUSTAIN_BLOCKS * 2), -CUT_SUSTAIN_BLOCKS); // 300 ms anteriores

    recentSpeechAvg = avgKey(recent, "speechScore");
    prevSpeechAvg = avgKey(previous, "speechScore");
    recentLowAvg = avgKey(recent, "lowBandScore");
    prevLowAvg = avgKey(previous, "lowBandScore");
    recentMoveAvg = avgKey(recent, "movementScore");

    const sustainedSilence = recent.every(x => x.speechScore < 25);
    const hadSpeechBefore = avgKey(previous, "speechScore") > 40;
    const droppedEnough = recentSpeechAvg < prevSpeechAvg * 0.58;
    const lowBandDropped = recentLowAvg < prevLowAvg * 0.70;
    const lowMovement = recentMoveAvg < 22;

    shouldCut =
      sustainedSilence &&
      hadSpeechBefore &&
      droppedEnough &&
      lowBandDropped &&
      lowMovement;
  }

  // ===== Regra de troca: mudança sustentada, não frame único =====
  if (smoothFrames.length >= SWITCH_SUSTAIN_BLOCKS * 2) {
    const recent = smoothFrames.slice(-SWITCH_SUSTAIN_BLOCKS);
    const previous = smoothFrames.slice(-(SWITCH_SUSTAIN_BLOCKS * 2), -SWITCH_SUSTAIN_BLOCKS);

    const deltaVol = Math.abs(avgKey(recent, "volScore") - avgKey(previous, "volScore"));
    const deltaLow = Math.abs(avgKey(recent, "lowBandScore") - avgKey(previous, "lowBandScore"));
    const deltaMove = Math.abs(avgKey(recent, "movementScore") - avgKey(previous, "movementScore"));
    const deltaCent = Math.abs(avgKey(recent, "centroidScore") - avgKey(previous, "centroidScore"));
    const deltaZcr = Math.abs(avgKey(recent, "zcrScore") - avgKey(previous, "zcrScore"));

    speakerDeltaRecent =
      deltaVol * 0.20 +
      deltaLow * 0.22 +
      deltaMove * 0.22 +
      deltaCent * 0.18 +
      deltaZcr * 0.18;

    const recentHasSpeech = avgKey(recent, "speechScore") > 35;
    const previousHasSpeech = avgKey(previous, "speechScore") > 35;
    const noSilenceGap = recent.every(x => x.speechScore > 28);

    shouldSwitch =
      previousHasSpeech &&
      recentHasSpeech &&
      noSilenceGap &&
      speakerDeltaRecent > 16;
  }

  return {
    rawItem,
    smoothItem,
    shouldCut,
    shouldSwitch,
    debug: {
      recentSpeechAvg,
      prevSpeechAvg,
      recentLowAvg,
      prevLowAvg,
      recentMoveAvg,
      speakerDeltaRecent
    }
  };
}

// ===== Indicadores =====
function throttledFlash(el, ms, type) {
  const now = performance.now();

  if (type === "cut") {
    if (now - lastCutFlashAt < ms) return;
    lastCutFlashAt = now;
  } else if (type === "switch") {
    if (now - lastSwitchFlashAt < ms) return;
    lastSwitchFlashAt = now;
  }

  flash(el, ms);
}

function flash(el, ms = 300) {
  el.classList.remove("active");
  void el.offsetWidth;
  el.classList.add("active");
  setTimeout(() => {
    el.classList.remove("active");
  }, ms);
}

// ===== Barras =====
function updateBars(features) {
  const fills = document.querySelectorAll(".fill");
  features.forEach((f, i) => {
    if (fills[i]) fills[i].style.height = `${clamp(f, 0, 100)}%`;
  });
}

// ===== Utils =====
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function avg(arr) {
  if (!arr || !arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function avgKey(arr, key) {
  return avg(arr.map(x => x[key]));
}

function avgAbsCentered(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += Math.abs(arr[i] - 128);
  }
  return sum / arr.length;
}

function weightedIndex(arr) {
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i] * i;
    wsum += arr[i];
  }
  return wsum ? sum / wsum : 0;
}

function bandEnergy(arr, startRatio, endRatio) {
  const start = Math.floor(arr.length * startRatio);
  const end = Math.max(start + 1, Math.floor(arr.length * endRatio));
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += arr[i];
  }
  return sum / (end - start);
}

function spectralMovement(curr, prev) {
  if (!prev || prev.length !== curr.length) return 0;
  let sum = 0;
  for (let i = 0; i < curr.length; i++) {
    sum += Math.abs(curr[i] - prev[i]);
  }
  return sum / curr.length;
}

function zeroCrossingRate(timeArr) {
  let crossings = 0;
  let prev = timeArr[0] - 128;

  for (let i = 1; i < timeArr.length; i++) {
    const curr = timeArr[i] - 128;
    if ((prev >= 0 && curr < 0) || (prev < 0 && curr >= 0)) {
      crossings++;
    }
    prev = curr;
  }

  return crossings / Math.max(1, timeArr.length - 1);
}