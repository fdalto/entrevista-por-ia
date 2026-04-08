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

const BAR_NAMES = ["VOLx20", "LOW", "MOVE", "CENT", "SPEECH", "PITCH", "ROLLOFF", "CHANGE"];

// ===== Configuracao =====
const FRAME_MS = 50;                 // bloco basico
const SMOOTH_N = 5;                  // media movel minima = 3 blocos = 150 ms
const HISTORY_MAX = 120;             // historico total
const CUT_SUSTAIN_BLOCKS = 6;        // 6 blocos suavizados = ~300 ms
const SWITCH_SUSTAIN_BLOCKS = 4;     // ~200 ms de mudanca sustentada
const CUT_FLASH_MS = 300;
const SWITCH_FLASH_MS = 300;
const SWITCH_SCORE_THRESHOLD = 17;
const SWITCH_LOCAL_SHIFT_THRESHOLD = 14;

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
    wrap.className = "bar-wrap";
    wrap.dataset.barName = name;

    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = name;

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
    alert("Nao foi possivel acessar o microfone.");
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
    streamRef.getTracks().forEach((t) => t.stop());
    streamRef = null;
  }

  if (ctx) {
    ctx.close();
    ctx = null;
  }

  clearIndicators();
  updateBars([0, 0, 0, 0, 0, 0, 0, 0]);
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
        result.smoothItem.speechScore,
        result.smoothItem.pitchScore,
        result.smoothItem.rolloffScore,
        result.debug.speakerChangeScore
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
        pitch: result.smoothItem.pitchScore.toFixed(1),
        rolloff: result.smoothItem.rolloffScore.toFixed(1),
        speechState: result.smoothItem.isSpeech ? "fala" : "nao_fala",
        recentSpeechAvg: result.debug.recentSpeechAvg.toFixed(1),
        prevSpeechAvg: result.debug.prevSpeechAvg.toFixed(1),
        recentLowAvg: result.debug.recentLowAvg.toFixed(1),
        prevLowAvg: result.debug.prevLowAvg.toFixed(1),
        recentMoveAvg: result.debug.recentMoveAvg.toFixed(1),
        deltaPitch: result.debug.deltaPitch.toFixed(1),
        deltaRolloff: result.debug.deltaRolloff.toFixed(1),
        deltaLow: result.debug.deltaLow.toFixed(1),
        deltaMove: result.debug.deltaMove.toFixed(1),
        deltaCent: result.debug.deltaCent.toFixed(1),
        deltaZcr: result.debug.deltaZcr.toFixed(1),
        deltaVol: result.debug.deltaVol.toFixed(1),
        previousSpeechAvgSwitch: result.debug.previousSpeechAvgSwitch.toFixed(1),
        recentSpeechAvgSwitch: result.debug.recentSpeechAvgSwitch.toFixed(1),
        sustainedShiftFrames: result.debug.sustainedShiftFrames,
        volumeDominant: result.debug.volumeDominant,
        speakerChangeScore: result.debug.speakerChangeScore.toFixed(1),
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
  const CENT_GAIN = 10;
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

  const pitchScore = estimatePitchScore(currentTime, ctx ? ctx.sampleRate : 44100);
  const rolloffScore = spectralRolloffScore(currentFreq, 0.85);

  // Heuristica de fala
  const weighted =
    volScore * 0.45 +
    lowBandScore * 0.28 +
    movementScore * 0.17 +
    centroidScore * 0.05 +
    zcrScore * 0.05;

  const maxFeature = Math.max(
    volScore,
    lowBandScore,
    movementScore
  );

  const speechScore =
    0.7 * weighted +
    0.3 * maxFeature;

  const rawItem = {
    volScore,
    lowBandScore,
    movementScore,
    centroidScore,
    zcrScore,
    speechScore,
    pitchScore,
    rolloffScore,
    ts: performance.now()
  };

  rawFrames.push(rawItem);
  if (rawFrames.length > HISTORY_MAX) rawFrames.shift();

  prevSpectrum = new Uint8Array(currentFreq);

  // Ainda nao temos 3 blocos para suavizar
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
        speakerDeltaRecent: 0,
        previousSpeechAvgSwitch: 0,
        recentSpeechAvgSwitch: 0,
        deltaPitch: 0,
        deltaRolloff: 0,
        deltaLow: 0,
        deltaMove: 0,
        deltaCent: 0,
        deltaZcr: 0,
        deltaVol: 0,
        speakerChangeScore: 0,
        sustainedShiftFrames: 0,
        volumeDominant: false
      }
    };
  }

  // ----- Media movel de 3 blocos -----
  const last3 = rawFrames.slice(-SMOOTH_N);
  const smoothItem = {
    volScore: avgKey(last3, "volScore"),
    lowBandScore: avgKey(last3, "lowBandScore"),
    movementScore: avgKey(last3, "movementScore"),
    centroidScore: avgKey(last3, "centroidScore"),
    zcrScore: avgKey(last3, "zcrScore"),
    speechScore: avgKey(last3, "speechScore"),
    pitchScore: avgKey(last3, "pitchScore"),
    rolloffScore: avgKey(last3, "rolloffScore"),
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

  let previousSpeechAvgSwitch = 0;
  let recentSpeechAvgSwitch = 0;
  let deltaPitch = 0;
  let deltaRolloff = 0;
  let deltaLow = 0;
  let deltaMove = 0;
  let deltaCent = 0;
  let deltaZcr = 0;
  let deltaVol = 0;
  let speakerChangeScore = 0;
  let sustainedShiftFrames = 0;
  let volumeDominant = false;

  // ===== Regra de corte: VAD heuristico + buffer temporal =====
  // Precisamos de fala antes e silencio sustentado depois.
  if (smoothFrames.length >= CUT_SUSTAIN_BLOCKS * 2) {
    const recent = smoothFrames.slice(-CUT_SUSTAIN_BLOCKS); // ultimos ~300 ms
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

  // ===== Regra de troca: comparacao robusta entre janelas =====
  if (smoothFrames.length >= SWITCH_SUSTAIN_BLOCKS * 2) {
    const recent = smoothFrames.slice(-SWITCH_SUSTAIN_BLOCKS);
    const previous = smoothFrames.slice(-(SWITCH_SUSTAIN_BLOCKS * 2), -SWITCH_SUSTAIN_BLOCKS);

    const change = computeSpeakerChangeScore(previous, recent);
    deltaPitch = change.deltaPitch;
    deltaRolloff = change.deltaRolloff;
    deltaLow = change.deltaLow;
    deltaMove = change.deltaMove;
    deltaCent = change.deltaCent;
    deltaZcr = change.deltaZcr;
    deltaVol = change.deltaVol;
    speakerChangeScore = change.score;
    speakerDeltaRecent = speakerChangeScore;

    previousSpeechAvgSwitch = change.previousSpeechAvg;
    recentSpeechAvgSwitch = change.recentSpeechAvg;

    const previousSpeechFrames = previous.filter((x) => x.isSpeech).length;
    const recentSpeechFrames = recent.filter((x) => x.isSpeech).length;
    const recentSilentFrames = recent.filter((x) => x.speechScore < SPEECH_OFF_THRESHOLD).length;

    sustainedShiftFrames = countSustainedChangeFrames(recent, change.previousMeans);
    volumeDominant =
      deltaVol > 18 &&
      (deltaPitch + deltaRolloff + deltaLow + deltaMove + deltaCent + deltaZcr) < 28;

    const previousHasSpeech =
      previousSpeechAvgSwitch > 35 &&
      previousSpeechFrames >= Math.max(2, SWITCH_SUSTAIN_BLOCKS - 1);
    const recentHasSpeech =
      recentSpeechAvgSwitch > 35 &&
      recentSpeechFrames >= Math.max(2, SWITCH_SUSTAIN_BLOCKS - 1);
    const noSilenceGap = recentSilentFrames <= 1;
    const sustainedChange = sustainedShiftFrames >= Math.max(2, SWITCH_SUSTAIN_BLOCKS - 1);

    shouldSwitch =
      !shouldCut &&
      previousHasSpeech &&
      recentHasSpeech &&
      noSilenceGap &&
      !volumeDominant &&
      sustainedChange &&
      speakerChangeScore > SWITCH_SCORE_THRESHOLD;
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
      speakerDeltaRecent,
      previousSpeechAvgSwitch,
      recentSpeechAvgSwitch,
      deltaPitch,
      deltaRolloff,
      deltaLow,
      deltaMove,
      deltaCent,
      deltaZcr,
      deltaVol,
      speakerChangeScore,
      sustainedShiftFrames,
      volumeDominant
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

// ===== Speaker change helpers =====
function computeSpeakerChangeScore(previousWindow, recentWindow) {
  const previousMeans = {
    volScore: avgKey(previousWindow, "volScore"),
    lowBandScore: avgKey(previousWindow, "lowBandScore"),
    movementScore: avgKey(previousWindow, "movementScore"),
    centroidScore: avgKey(previousWindow, "centroidScore"),
    zcrScore: avgKey(previousWindow, "zcrScore"),
    pitchScore: avgKey(previousWindow, "pitchScore"),
    rolloffScore: avgKey(previousWindow, "rolloffScore")
  };

  const recentMeans = {
    volScore: avgKey(recentWindow, "volScore"),
    lowBandScore: avgKey(recentWindow, "lowBandScore"),
    movementScore: avgKey(recentWindow, "movementScore"),
    centroidScore: avgKey(recentWindow, "centroidScore"),
    zcrScore: avgKey(recentWindow, "zcrScore"),
    pitchScore: avgKey(recentWindow, "pitchScore"),
    rolloffScore: avgKey(recentWindow, "rolloffScore")
  };

  const deltaVol = Math.abs(recentMeans.volScore - previousMeans.volScore);
  const deltaLow = Math.abs(recentMeans.lowBandScore - previousMeans.lowBandScore);
  const deltaMove = Math.abs(recentMeans.movementScore - previousMeans.movementScore);
  const deltaCent = Math.abs(recentMeans.centroidScore - previousMeans.centroidScore);
  const deltaZcr = Math.abs(recentMeans.zcrScore - previousMeans.zcrScore);
  const deltaPitch = Math.abs(recentMeans.pitchScore - previousMeans.pitchScore);
  const deltaRolloff = Math.abs(recentMeans.rolloffScore - previousMeans.rolloffScore);

  const score =
    deltaPitch * 0.24 +
    deltaRolloff * 0.18 +
    deltaLow * 0.16 +
    deltaMove * 0.14 +
    deltaCent * 0.10 +
    deltaZcr * 0.08 +
    deltaVol * 0.10;

  return {
    previousMeans,
    recentMeans,
    previousSpeechAvg: avgKey(previousWindow, "speechScore"),
    recentSpeechAvg: avgKey(recentWindow, "speechScore"),
    deltaVol,
    deltaLow,
    deltaMove,
    deltaCent,
    deltaZcr,
    deltaPitch,
    deltaRolloff,
    score
  };
}

function countSustainedChangeFrames(recentWindow, previousMeans) {
  return recentWindow.filter((frame) => {
    const localScore =
      Math.abs(frame.pitchScore - previousMeans.pitchScore) * 0.24 +
      Math.abs(frame.rolloffScore - previousMeans.rolloffScore) * 0.18 +
      Math.abs(frame.lowBandScore - previousMeans.lowBandScore) * 0.16 +
      Math.abs(frame.movementScore - previousMeans.movementScore) * 0.14 +
      Math.abs(frame.centroidScore - previousMeans.centroidScore) * 0.10 +
      Math.abs(frame.zcrScore - previousMeans.zcrScore) * 0.08 +
      Math.abs(frame.volScore - previousMeans.volScore) * 0.10;

    return localScore > SWITCH_LOCAL_SHIFT_THRESHOLD;
  }).length;
}

// ===== Feature helpers =====
function estimatePitchScore(timeArr, sampleRate) {
  const centered = toCenteredFloatBuffer(timeArr);
  const hz = estimatePitchHz(centered, sampleRate);
  return normalizePitchToScore(hz);
}

function estimatePitchHz(buffer, sampleRate) {
  if (!buffer || buffer.length < 64) return 0;

  let energy = 0;
  for (let i = 0; i < buffer.length; i++) {
    energy += buffer[i] * buffer[i];
  }
  const rmsValue = Math.sqrt(energy / buffer.length);
  if (rmsValue < 0.02) return 0;

  const minHz = 80;
  const maxHz = 350;
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(Math.floor(sampleRate / minHz), buffer.length - 2);

  let bestLag = 0;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < buffer.length - lag; i++) {
      corr += buffer[i] * buffer[i + lag];
    }
    corr /= (buffer.length - lag);

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (!bestLag || bestCorr < 0.01) return 0;
  const hz = sampleRate / bestLag;
  if (hz < minHz || hz > maxHz) return 0;
  return hz;
}

function normalizePitchToScore(hz) {
  if (!hz) return 0;
  return clamp(((hz - 80) / (350 - 80)) * 100, 0, 100);
}

function spectralRolloffScore(arr, ratio = 0.85) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i];
  }
  if (total <= 0) return 0;

  const target = total * ratio;
  let cumulative = 0;

  for (let i = 0; i < arr.length; i++) {
    cumulative += arr[i];
    if (cumulative >= target) {
      return clamp((i / Math.max(1, arr.length - 1)) * 100, 0, 100);
    }
  }

  return 100;
}

function toCenteredFloatBuffer(timeArr) {
  const buffer = new Float32Array(timeArr.length);
  for (let i = 0; i < timeArr.length; i++) {
    buffer[i] = (timeArr[i] - 128) / 128;
  }
  return buffer;
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
