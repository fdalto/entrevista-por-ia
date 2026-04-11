(function () {
  const env = window.AppEnv;
  const ui = window.RenderV3;
  const cal = window.DynamicCalV3;
  const state = env.APP_STATE;
  const cfg = env.CONFIG;

  ui.refs.recordBtn.onclick = async function () {
    if (!state.recording) {
      await startRecording();
    } else {
      stopRecording();
    }
  };

  ui.refs.testSoundBtn.onclick = async function () {
    if (!state.recording) {
      const ok = await startRecording();
      if (!ok) return;
    }
    await cal.startDynamicCalibration();
  };

  async function startRecording() {
    try {
      state.streamRef = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true
        }
      });

      state.ctx = new (window.AudioContext || window.webkitAudioContext)();
      state.analyser = state.ctx.createAnalyser();
      state.source = state.ctx.createMediaStreamSource(state.streamRef);
      state.source.connect(state.analyser);

      state.analyser.fftSize = 1024;
      state.analyser.smoothingTimeConstant = 0.15;

      state.freqData = new Uint8Array(state.analyser.frequencyBinCount);
      state.timeData = new Uint8Array(state.analyser.fftSize);

      state.recording = true;
      ui.refs.recordBtn.innerText = "PARAR";

      state.rawFrames = [];
      state.smoothFrames = [];
      state.prevSpectrum = null;
      state.lastCutFlashAt = 0;
      state.lastSwitchFlashAt = 0;

      startScopeLoop();
      startProcessing();
      return true;
    } catch (err) {
      console.error(err);
      alert("Nao foi possivel acessar o microfone.");
      return false;
    }
  }

  function stopRecording() {
    cal.cancelDynamicCalibration();

    state.recording = false;
    ui.refs.recordBtn.innerText = "GRAVAR";

    if (state.processingTimer) {
      clearInterval(state.processingTimer);
      state.processingTimer = null;
    }

    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }

    if (state.streamRef) {
      state.streamRef.getTracks().forEach(function (t) { t.stop(); });
      state.streamRef = null;
    }

    if (state.ctx) {
      state.ctx.close();
      state.ctx = null;
    }

    state.analyser = null;
    state.source = null;
    ui.clearIndicators();
    ui.updateBars([0, 0, 0, 0, 0, 0, 0, 0]);
  }

  function startScopeLoop() {
    if (!state.recording || !state.analyser) return;

    state.analyser.getByteFrequencyData(state.freqData);
    ui.drawScope(state.freqData);
    state.rafId = requestAnimationFrame(startScopeLoop);
  }

  function startProcessing() {
    state.processingTimer = setInterval(function () {
      if (!state.recording || !state.analyser) return;

      state.analyser.getByteFrequencyData(state.freqData);
      state.analyser.getByteTimeDomainData(state.timeData);

      const result = process50msFrame(state.freqData, state.timeData);
      if (!result.smoothItem) return;

      ui.updateBars([
        result.smoothItem.volScore,
        result.smoothItem.lowBandScore,
        result.smoothItem.movementScore,
        result.smoothItem.centroidScore,
        result.smoothItem.speechScore,
        result.smoothItem.pitchScore,
        result.smoothItem.rolloffScore,
        result.debug.speakerChangeScore
      ]);

      if (result.shouldCut) throttledFlash(ui.refs.cutEl, cfg.CUT_FLASH_MS, "cut");
      if (result.shouldSwitch) throttledFlash(ui.refs.switchEl, cfg.SWITCH_FLASH_MS, "switch");

      cal.collectCalibrationFrame(result.smoothItem);

      const latestCalLog = state.calibrationLogs.length
        ? state.calibrationLogs[state.calibrationLogs.length - 1]
        : null;

      ui.updateLog({
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
        shouldSwitch: result.shouldSwitch,
        calibrationMode: state.calibrationMode,
        calibrationState: state.calibrationStateMachine,
        calibrationRound: state.calibrationRound,
        trustedSpeech: state.calibrationBuffers.trustedSpeech.length,
        trustedSilence: state.calibrationBuffers.trustedSilence.length,
        gains: {
          vol: Number(state.featureState.vol.finalGain.toFixed(3)),
          low: Number(state.featureState.low.finalGain.toFixed(3)),
          move: Number(state.featureState.move.finalGain.toFixed(3)),
          cent: Number(state.featureState.cent.finalGain.toFixed(3)),
          zcr: Number(state.featureState.zcr.finalGain.toFixed(3))
        },
        offsets: {
          vol: Number((state.featureState.vol.finalOffset || 0).toFixed(3)),
          low: Number((state.featureState.low.finalOffset || 0).toFixed(3)),
          move: Number((state.featureState.move.finalOffset || 0).toFixed(3)),
          cent: Number((state.featureState.cent.finalOffset || 0).toFixed(3)),
          zcr: Number((state.featureState.zcr.finalOffset || 0).toFixed(3))
        },
        weights: {
          vol: Number(state.speechWeights.vol.toFixed(3)),
          low: Number(state.speechWeights.low.toFixed(3)),
          move: Number(state.speechWeights.move.toFixed(3)),
          cent: Number(state.speechWeights.cent.toFixed(3)),
          zcr: Number(state.speechWeights.zcr.toFixed(3))
        },
        lastCalibrationLog: latestCalLog
      });
    }, cfg.FRAME_MS);
  }

  function process50msFrame(currentFreq, currentTime) {
    const rawVolNorm = avgAbsCentered(currentTime) / 128;
    const rawVolMapped = (rawVolNorm * 15) * 100;
    const volScore = env.clamp(
      rawVolMapped * state.featureState.vol.finalGain + (state.featureState.vol.finalOffset || 0),
      0,
      100
    );

    const lowBand = bandEnergy(currentFreq, 0.00, 0.18);
    const rawLowMapped = (lowBand / 255) * 220;
    const lowBandScore = env.clamp(
      rawLowMapped * state.featureState.low.finalGain + (state.featureState.low.finalOffset || 0),
      0,
      100
    );

    const movement = spectralMovement(currentFreq, state.prevSpectrum);
    const rawMoveMapped = movement * 2.2;
    const movementScore = env.clamp(
      rawMoveMapped * state.featureState.move.finalGain + (state.featureState.move.finalOffset || 0),
      0,
      100
    );

    const centroidNorm = weightedIndex(currentFreq) / Math.max(1, currentFreq.length);
    const rawCentMapped = centroidNorm * 100;
    const centroidScore = env.clamp(
      rawCentMapped * state.featureState.cent.finalGain + (state.featureState.cent.finalOffset || 0),
      0,
      100
    );

    const zcr = zeroCrossingRate(currentTime);
    const rawZcrMapped = zcr * 140;
    const zcrScore = env.clamp(
      rawZcrMapped * state.featureState.zcr.finalGain + (state.featureState.zcr.finalOffset || 0),
      0,
      100
    );

    const pitchScore = estimatePitchScore(currentTime, state.ctx ? state.ctx.sampleRate : 44100);
    const rolloffScore = spectralRolloffScore(currentFreq, 0.85);

    const weighted =
      volScore * state.speechWeights.vol +
      lowBandScore * state.speechWeights.low +
      movementScore * state.speechWeights.move +
      centroidScore * state.speechWeights.cent +
      zcrScore * state.speechWeights.zcr;

    const maxFeature = Math.max(volScore, lowBandScore, movementScore);

    const speechScore =
      0.7 * weighted +
      0.3 * maxFeature;

    const rawItem = {
      volScore: volScore,
      lowBandScore: lowBandScore,
      movementScore: movementScore,
      centroidScore: centroidScore,
      zcrScore: zcrScore,
      speechScore: speechScore,
      pitchScore: pitchScore,
      rolloffScore: rolloffScore,
      ts: env.nowMs()
    };

    state.rawFrames.push(rawItem);
    if (state.rawFrames.length > cfg.HISTORY_MAX) state.rawFrames.shift();

    state.prevSpectrum = new Uint8Array(currentFreq);

    if (state.rawFrames.length < cfg.SMOOTH_N) {
      return {
        rawItem: rawItem,
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

    const last3 = state.rawFrames.slice(-cfg.SMOOTH_N);
    const smoothItem = {
      volScore: env.avgKey(last3, "volScore"),
      lowBandScore: env.avgKey(last3, "lowBandScore"),
      movementScore: env.avgKey(last3, "movementScore"),
      centroidScore: env.avgKey(last3, "centroidScore"),
      zcrScore: env.avgKey(last3, "zcrScore"),
      speechScore: env.avgKey(last3, "speechScore"),
      pitchScore: env.avgKey(last3, "pitchScore"),
      rolloffScore: env.avgKey(last3, "rolloffScore"),
      ts: env.nowMs()
    };

    const prevSmooth = state.smoothFrames.length ? state.smoothFrames[state.smoothFrames.length - 1] : null;
    if (!prevSmooth) {
      smoothItem.isSpeech = smoothItem.speechScore >= cfg.SPEECH_ON_THRESHOLD;
    } else if (prevSmooth.isSpeech) {
      smoothItem.isSpeech = smoothItem.speechScore >= cfg.SPEECH_OFF_THRESHOLD;
    } else {
      smoothItem.isSpeech = smoothItem.speechScore >= cfg.SPEECH_ON_THRESHOLD;
    }

    state.smoothFrames.push(smoothItem);
    if (state.smoothFrames.length > cfg.HISTORY_MAX) state.smoothFrames.shift();

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

    if (state.smoothFrames.length >= cfg.CUT_SUSTAIN_BLOCKS * 2) {
      const recent = state.smoothFrames.slice(-cfg.CUT_SUSTAIN_BLOCKS);
      const previous = state.smoothFrames.slice(-(cfg.CUT_SUSTAIN_BLOCKS * 2), -cfg.CUT_SUSTAIN_BLOCKS);

      recentSpeechAvg = env.avgKey(recent, "speechScore");
      prevSpeechAvg = env.avgKey(previous, "speechScore");
      recentLowAvg = env.avgKey(recent, "lowBandScore");
      prevLowAvg = env.avgKey(previous, "lowBandScore");
      recentMoveAvg = env.avgKey(recent, "movementScore");

      const sustainedSilence = recent.every(function (x) { return x.speechScore < 25; });
      const hadSpeechBefore = env.avgKey(previous, "speechScore") > 40;
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

    if (state.smoothFrames.length >= cfg.SWITCH_SUSTAIN_BLOCKS * 2) {
      const recent = state.smoothFrames.slice(-cfg.SWITCH_SUSTAIN_BLOCKS);
      const previous = state.smoothFrames.slice(-(cfg.SWITCH_SUSTAIN_BLOCKS * 2), -cfg.SWITCH_SUSTAIN_BLOCKS);

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

      const previousSpeechFrames = previous.filter(function (x) { return x.isSpeech; }).length;
      const recentSpeechFrames = recent.filter(function (x) { return x.isSpeech; }).length;
      const recentSilentFrames = recent.filter(function (x) { return x.speechScore < cfg.SPEECH_OFF_THRESHOLD; }).length;

      sustainedShiftFrames = countSustainedChangeFrames(recent, change.previousMeans);
      volumeDominant =
        deltaVol > 18 &&
        (deltaPitch + deltaRolloff + deltaLow + deltaMove + deltaCent + deltaZcr) < 28;

      const previousHasSpeech =
        previousSpeechAvgSwitch > 35 &&
        previousSpeechFrames >= Math.max(2, cfg.SWITCH_SUSTAIN_BLOCKS - 1);
      const recentHasSpeech =
        recentSpeechAvgSwitch > 35 &&
        recentSpeechFrames >= Math.max(2, cfg.SWITCH_SUSTAIN_BLOCKS - 1);
      const noSilenceGap = recentSilentFrames <= 1;
      const sustainedChange = sustainedShiftFrames >= Math.max(2, cfg.SWITCH_SUSTAIN_BLOCKS - 1);

      shouldSwitch =
        !shouldCut &&
        previousHasSpeech &&
        recentHasSpeech &&
        noSilenceGap &&
        !volumeDominant &&
        sustainedChange &&
        speakerChangeScore > cfg.SWITCH_SCORE_THRESHOLD;
    }

    return {
      rawItem: rawItem,
      smoothItem: smoothItem,
      shouldCut: shouldCut,
      shouldSwitch: shouldSwitch,
      debug: {
        recentSpeechAvg: recentSpeechAvg,
        prevSpeechAvg: prevSpeechAvg,
        recentLowAvg: recentLowAvg,
        prevLowAvg: prevLowAvg,
        recentMoveAvg: recentMoveAvg,
        speakerDeltaRecent: speakerDeltaRecent,
        previousSpeechAvgSwitch: previousSpeechAvgSwitch,
        recentSpeechAvgSwitch: recentSpeechAvgSwitch,
        deltaPitch: deltaPitch,
        deltaRolloff: deltaRolloff,
        deltaLow: deltaLow,
        deltaMove: deltaMove,
        deltaCent: deltaCent,
        deltaZcr: deltaZcr,
        deltaVol: deltaVol,
        speakerChangeScore: speakerChangeScore,
        sustainedShiftFrames: sustainedShiftFrames,
        volumeDominant: volumeDominant
      }
    };
  }

  function throttledFlash(el, ms, type) {
    const now = env.nowMs();

    if (type === "cut") {
      if (now - state.lastCutFlashAt < ms) return;
      state.lastCutFlashAt = now;
    } else if (type === "switch") {
      if (now - state.lastSwitchFlashAt < ms) return;
      state.lastSwitchFlashAt = now;
    }

    ui.flashIndicator(el, ms);
  }

  function computeSpeakerChangeScore(previousWindow, recentWindow) {
    const previousMeans = {
      volScore: env.avgKey(previousWindow, "volScore"),
      lowBandScore: env.avgKey(previousWindow, "lowBandScore"),
      movementScore: env.avgKey(previousWindow, "movementScore"),
      centroidScore: env.avgKey(previousWindow, "centroidScore"),
      zcrScore: env.avgKey(previousWindow, "zcrScore"),
      pitchScore: env.avgKey(previousWindow, "pitchScore"),
      rolloffScore: env.avgKey(previousWindow, "rolloffScore")
    };

    const recentMeans = {
      volScore: env.avgKey(recentWindow, "volScore"),
      lowBandScore: env.avgKey(recentWindow, "lowBandScore"),
      movementScore: env.avgKey(recentWindow, "movementScore"),
      centroidScore: env.avgKey(recentWindow, "centroidScore"),
      zcrScore: env.avgKey(recentWindow, "zcrScore"),
      pitchScore: env.avgKey(recentWindow, "pitchScore"),
      rolloffScore: env.avgKey(recentWindow, "rolloffScore")
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
      previousMeans: previousMeans,
      recentMeans: recentMeans,
      previousSpeechAvg: env.avgKey(previousWindow, "speechScore"),
      recentSpeechAvg: env.avgKey(recentWindow, "speechScore"),
      deltaVol: deltaVol,
      deltaLow: deltaLow,
      deltaMove: deltaMove,
      deltaCent: deltaCent,
      deltaZcr: deltaZcr,
      deltaPitch: deltaPitch,
      deltaRolloff: deltaRolloff,
      score: score
    };
  }

  function countSustainedChangeFrames(recentWindow, previousMeans) {
    return recentWindow.filter(function (frame) {
      const localScore =
        Math.abs(frame.pitchScore - previousMeans.pitchScore) * 0.24 +
        Math.abs(frame.rolloffScore - previousMeans.rolloffScore) * 0.18 +
        Math.abs(frame.lowBandScore - previousMeans.lowBandScore) * 0.16 +
        Math.abs(frame.movementScore - previousMeans.movementScore) * 0.14 +
        Math.abs(frame.centroidScore - previousMeans.centroidScore) * 0.10 +
        Math.abs(frame.zcrScore - previousMeans.zcrScore) * 0.08 +
        Math.abs(frame.volScore - previousMeans.volScore) * 0.10;

      return localScore > cfg.SWITCH_LOCAL_SHIFT_THRESHOLD;
    }).length;
  }

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
    return env.clamp(((hz - 80) / (350 - 80)) * 100, 0, 100);
  }

  function spectralRolloffScore(arr, ratio) {
    const r = ratio || 0.85;
    let total = 0;
    for (let i = 0; i < arr.length; i++) {
      total += arr[i];
    }
    if (total <= 0) return 0;

    const target = total * r;
    let cumulative = 0;

    for (let i = 0; i < arr.length; i++) {
      cumulative += arr[i];
      if (cumulative >= target) {
        return env.clamp((i / Math.max(1, arr.length - 1)) * 100, 0, 100);
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

  window.AudioCoreV3 = {
    startRecording: startRecording,
    stopRecording: stopRecording,
    process50msFrame: process50msFrame
  };
})();
