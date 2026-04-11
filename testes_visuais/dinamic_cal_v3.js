(function () {
  const env = window.AppEnv;
  const ui = window.RenderV3;
  const state = env.APP_STATE;

  const FEATURE_TO_FRAME_KEY = {
    vol: "volScore",
    low: "lowBandScore",
    move: "movementScore",
    cent: "centroidScore",
    zcr: "zcrScore"
  };

  const STATE_MACHINE = [
    "idle",
    "round1_silence",
    "round1_aaaa",
    "round1_dynamic",
    "round1_apply_gain",
    "round2_silence",
    "round2_aaaa",
    "round2_dynamic",
    "round2_apply_gain",
    "round3_silence",
    "round3_aaaa",
    "round3_dynamic",
    "round3_apply_weights",
    "done"
  ];

  function setMachineState(name) {
    state.calibrationStateMachine = name;
    state.calibrationPhase = name;
  }

  function appendCalibrationLog(message, data) {
    const item = {
      ts: new Date().toISOString(),
      message: message,
      data: data || null
    };
    state.calibrationLogs.push(item);
    if (state.calibrationLogs.length > 80) state.calibrationLogs.shift();
  }

  function resetRoundBuffers() {
    state.calibrationBuffers = env.createRoundBuffers();
    return state.calibrationBuffers;
  }

  function stepKeyFromState(phaseState) {
    if (phaseState.indexOf("silence") !== -1) return "silence";
    if (phaseState.indexOf("aaaa") !== -1) return "aaaa";
    if (phaseState.indexOf("dynamic") !== -1) return "dynamic";
    return null;
  }

  function startCalibrationPhase(phaseName, durationMs, roundNumber, substatus) {
    setMachineState(phaseName);
    const startAt = env.nowMs();
    const endsAt = startAt + durationMs;

    ui.showCalibrationOverlay();
    ui.updateCalibrationOverlay({
      roundLabel: "RODADA " + roundNumber + "/3",
      activeStep: stepKeyFromState(phaseName),
      countdownMs: durationMs,
      substatus: substatus || "coletando"
    });

    appendCalibrationLog("phase_start", {
      round: roundNumber,
      phase: phaseName,
      durationMs: durationMs
    });

    return { startAt: startAt, endsAt: endsAt, phaseName: phaseName };
  }

  function updateOverlayCountdown(ctx) {
    const msLeft = Math.max(0, ctx.endsAt - env.nowMs());
    ui.updateCalibrationOverlay({
      roundLabel: "RODADA " + state.calibrationRound + "/3",
      activeStep: stepKeyFromState(ctx.phaseName),
      countdownMs: msLeft,
      substatus: substatusForState(ctx.phaseName)
    });
  }

  function finishCalibrationPhase(ctx) {
    updateOverlayCountdown(ctx);
    appendCalibrationLog("phase_done", {
      round: state.calibrationRound,
      phase: ctx.phaseName
    });
  }

  function phaseLabelForState(phaseState) {
    if (phaseState.indexOf("silence") !== -1) return "FIQUE EM SILENCIO";
    if (phaseState.indexOf("aaaa") !== -1) return "DIGA AAAAAAAAAA por 1,5 segundos";
    if (phaseState.indexOf("dynamic") !== -1) return "FALE NORMALMENTE";
    if (phaseState.indexOf("apply") !== -1) return "APLICANDO AJUSTE";
    if (phaseState === "done") return "CALIBRACAO FINALIZADA";
    return "Aguardando...";
  }

  function substatusForState(phaseState) {
    if (phaseState.indexOf("silence") !== -1) return "coletando baseline";
    if (phaseState.indexOf("aaaa") !== -1) return "coletando fala estavel";
    if (phaseState.indexOf("dynamic") !== -1) return "classificando blocos por speechScore";
    if (phaseState === "round3_apply_weights") return "ajustando pesos dinamicos";
    if (phaseState.indexOf("apply") !== -1) return "ajustando ganhos dinamicos";
    return "-";
  }

  function runTimedPhase(phaseState, roundNumber, durationMs) {
    return new Promise(function (resolve) {
      const ctx = startCalibrationPhase(
        phaseState,
        durationMs,
        roundNumber,
        substatusForState(phaseState)
      );

      const timer = setInterval(function () {
        if (!state.calibrationRunning || state.calibrationToken !== activeToken) {
          clearInterval(timer);
          resolve(false);
          return;
        }

        updateOverlayCountdown(ctx);

        if (env.nowMs() >= ctx.endsAt) {
          clearInterval(timer);
          finishCalibrationPhase(ctx);
          resolve(true);
        }
      }, 100);
    });
  }

  function collectFeatureSample(frame, kind) {
    env.FEATURE_KEYS.forEach(function (featureKey) {
      const frameKey = FEATURE_TO_FRAME_KEY[featureKey];
      state.calibrationBuffers.features[featureKey][kind].push(frame[frameKey]);
    });
  }

  function collectCalibrationFrame(frame) {
    if (!state.calibrationMode || !state.calibrationRunning || !frame) return;

    state.calibrationBuffers.raw.push(frame);
    state.calibrationBuffers.smooth.push(frame);

    const phase = state.calibrationStateMachine;
    if (phase.indexOf("silence") !== -1) {
      state.calibrationBuffers.trustedSilence.push(frame);
      collectFeatureSample(frame, "silence");
      return;
    }

    if (phase.indexOf("aaaa") !== -1) {
      state.calibrationBuffers.trustedAaaa.push(frame);
      state.calibrationBuffers.trustedSpeech.push(frame);
      collectFeatureSample(frame, "aaaa");
      collectFeatureSample(frame, "speech");
      return;
    }

    if (phase.indexOf("dynamic") !== -1) {
      if (frame.speechScore > env.CONFIDENCE_THRESHOLDS.speechHigh) {
        state.calibrationBuffers.trustedSpeech.push(frame);
        collectFeatureSample(frame, "speech");
      } else if (frame.speechScore < env.CONFIDENCE_THRESHOLDS.silenceLow) {
        state.calibrationBuffers.trustedSilence.push(frame);
        collectFeatureSample(frame, "silence");
      }
    }
  }

  function clampGain(featureKey, gain) {
    const limit = env.GAIN_LIMITS[featureKey];
    return env.clamp(gain, limit.min, limit.max);
  }

  function clampOffset(featureKey, offset) {
    const limit = env.OFFSET_LIMITS[featureKey];
    return env.clamp(offset, limit.min, limit.max);
  }

  function applyGainCalibration(roundBuffers) {
    const targets = env.CALIBRATION_TARGETS;
    const epsilon = 0.5;
    const summary = {};

    env.FEATURE_KEYS.forEach(function (featureKey) {
      const silenceSamples = roundBuffers.features[featureKey].silence;
      const aaaaSamples = roundBuffers.features[featureKey].aaaa;
      const speechSamples = roundBuffers.features[featureKey].speech;
      if (!silenceSamples.length && !aaaaSamples.length && !speechSamples.length) {
        summary[featureKey] = { skipped: true, reason: "few_samples" };
        return;
      }

      const featureState = state.featureState[featureKey];
      const oldGain = featureState.finalGain;
      const oldOffset = featureState.finalOffset || 0;
      const silenceMedian = silenceSamples.length ? env.median(silenceSamples) : 0;
      const aaaaMedian = aaaaSamples.length ? env.median(aaaaSamples) : 0;
      const speechMedian = speechSamples.length ? env.median(speechSamples) : 0;
      const targetSilence = targets.targetSilence;
      const targetAaaa = targets.targetAaaa;

      let gainTarget = oldGain;
      let offsetTarget = oldOffset;
      const delta = aaaaMedian - silenceMedian;
      let usedDegenerateFallback = false;

      if (Math.abs(delta) < epsilon || !silenceMedian || !aaaaMedian) {
        usedDegenerateFallback = true;
        if (silenceMedian > 0) {
          offsetTarget = oldOffset + (targetSilence - silenceMedian) * 0.25;
        }
        gainTarget = oldGain;
      } else {
        gainTarget = (targetAaaa - targetSilence) / delta;
        offsetTarget = targetSilence - gainTarget * silenceMedian;
      }

      const clampedGainTarget = clampGain(featureKey, gainTarget);
      const clampedOffsetTarget = clampOffset(featureKey, offsetTarget);
      const newGain = clampGain(featureKey, oldGain * 0.7 + clampedGainTarget * 0.3);
      const newOffset = clampOffset(featureKey, oldOffset * 0.7 + clampedOffsetTarget * 0.3);

      featureState.finalGain = newGain;
      featureState.dynamicGain = newGain / Math.max(1e-6, featureState.baseGain);
      featureState.finalOffset = newOffset;
      featureState.dynamicOffset = newOffset;

      summary[featureKey] = {
        silenceMedian: Number(silenceMedian.toFixed(2)),
        aaaaMedian: Number(aaaaMedian.toFixed(2)),
        speechMedian: Number(speechMedian.toFixed(2)),
        targetSilence: targetSilence,
        targetAaaa: targetAaaa,
        oldGain: Number(oldGain.toFixed(3)),
        gainTarget: Number(clampedGainTarget.toFixed(3)),
        newGain: Number(newGain.toFixed(3)),
        oldOffset: Number(oldOffset.toFixed(3)),
        offsetTarget: Number(clampedOffsetTarget.toFixed(3)),
        newOffset: Number(newOffset.toFixed(3)),
        degenerateFallback: usedDegenerateFallback
      };
    });

    appendCalibrationLog("gain_calibration", summary);
    return summary;
  }

  function normalizeWeights(weights) {
    const minWeight = 0.02;
    const keys = env.FEATURE_KEYS.slice();
    const clamped = {};

    keys.forEach(function (key) {
      clamped[key] = Math.max(minWeight, weights[key] || 0);
    });

    const sum = keys.reduce(function (acc, key) { return acc + clamped[key]; }, 0);
    if (sum <= 0) {
      const uniform = 1 / keys.length;
      keys.forEach(function (key) { clamped[key] = uniform; });
      return clamped;
    }

    keys.forEach(function (key) {
      clamped[key] = clamped[key] / sum;
    });

    return clamped;
  }

  function smoothWeights(oldWeights, newWeights, alpha) {
    const mixed = {};
    env.FEATURE_KEYS.forEach(function (key) {
      mixed[key] = oldWeights[key] * (1 - alpha) + newWeights[key] * alpha;
    });
    return normalizeWeights(mixed);
  }

  function applyWeightCalibration(roundBuffers) {
    const separations = {};
    const medianByFeature = {};

    env.FEATURE_KEYS.forEach(function (featureKey) {
      const speech = roundBuffers.features[featureKey].speech;
      const silence = roundBuffers.features[featureKey].silence;
      const medianSpeech = speech.length ? env.median(speech) : 0;
      const medianSilence = silence.length ? env.median(silence) : 0;

      if (!speech.length || !silence.length) {
        separations[featureKey] = 0;
      } else {
        separations[featureKey] = Math.abs(medianSpeech - medianSilence);
      }
      medianByFeature[featureKey] = {
        medianSpeech: Number(medianSpeech.toFixed(3)),
        medianSilence: Number(medianSilence.toFixed(3))
      };
    });

    const ordered = Object.keys(separations).sort(function (a, b) {
      return separations[a] - separations[b];
    });
    const worstTwo = ordered.slice(0, 2);

    const target = Object.assign({}, state.speechWeights);
    worstTwo.forEach(function (key) {
      target[key] = target[key] * 0.5;
    });

    const normalizedTarget = normalizeWeights(target);
    const smoothed = smoothWeights(state.speechWeights, normalizedTarget, 0.3);
    const finalWeights = normalizeWeights(smoothed);
    state.speechWeights = finalWeights;

    const summary = {
      medians: medianByFeature,
      separations: Object.keys(separations).reduce(function (acc, key) {
        acc[key] = Number(separations[key].toFixed(3));
        return acc;
      }, {}),
      worstTwo: worstTwo,
      newWeights: Object.keys(finalWeights).reduce(function (acc, key) {
        acc[key] = Number(finalWeights[key].toFixed(4));
        return acc;
      }, {})
    };

    appendCalibrationLog("weight_calibration", summary);
    return summary;
  }

  async function runCalibrationRound(roundNumber) {
    state.calibrationRound = roundNumber;
    resetRoundBuffers();

    const prefix = "round" + roundNumber;
    const steps = [
      prefix + "_silence",
      prefix + "_aaaa",
      prefix + "_dynamic"
    ];

    for (let i = 0; i < steps.length; i++) {
      const phase = steps[i];
      const duration = phase.indexOf("silence") !== -1
        ? env.CALIBRATION_TIMINGS.silenceMs
        : (phase.indexOf("aaaa") !== -1 ? env.CALIBRATION_TIMINGS.aaaaMs : env.CALIBRATION_TIMINGS.dynamicMs);

      const ok = await runTimedPhase(phase, roundNumber, duration);
      if (!ok) return false;
    }

    const applyState = roundNumber < 3 ? prefix + "_apply_gain" : prefix + "_apply_weights";
    setMachineState(applyState);
    ui.updateCalibrationOverlay({
      roundLabel: "RODADA " + roundNumber + "/3",
      activeStep: null,
      countdownMs: 0,
      substatus: substatusForState(applyState)
    });

    const roundSummary = {
      round: roundNumber,
      trustedAaaa: state.calibrationBuffers.trustedAaaa.length,
      trustedSpeech: state.calibrationBuffers.trustedSpeech.length,
      trustedSilence: state.calibrationBuffers.trustedSilence.length
    };

    if (roundNumber < 3) {
      roundSummary.gains = applyGainCalibration(state.calibrationBuffers);
    } else {
      roundSummary.weights = applyWeightCalibration(state.calibrationBuffers);
    }

    appendCalibrationLog("round_summary", roundSummary);
    await new Promise(function (resolve) { setTimeout(resolve, 350); });
    return true;
  }

  let activeToken = 0;

  async function startDynamicCalibration() {
    if (state.calibrationRunning) return;

    state.calibrationMode = true;
    state.calibrationRunning = true;
    state.calibrationRound = 0;
    state.calibrationLogs = [];

    activeToken = (state.calibrationToken || 0) + 1;
    state.calibrationToken = activeToken;

    appendCalibrationLog("calibration_start", {
      states: STATE_MACHINE.slice()
    });

    ui.refs.testSoundBtn.disabled = true;
    ui.showCalibrationOverlay();

    try {
      const ok1 = await runCalibrationRound(1);
      if (!ok1) return;
      const ok2 = await runCalibrationRound(2);
      if (!ok2) return;
      const ok3 = await runCalibrationRound(3);
      if (!ok3) return;

      setMachineState("done");
      ui.updateCalibrationOverlay({
        roundLabel: "RODADA 3/3",
        activeStep: null,
        countdownMs: 0,
        substatus: "ganhos e pesos atualizados"
      });

      appendCalibrationLog("calibration_done", {
        finalGains: getFinalGains(),
        finalOffsets: getFinalOffsets(),
        finalWeights: Object.assign({}, state.speechWeights)
      });

      await new Promise(function (resolve) { setTimeout(resolve, 700); });
    } finally {
      state.calibrationMode = false;
      state.calibrationRunning = false;
      state.calibrationPhase = "idle";
      ui.refs.testSoundBtn.disabled = false;
      ui.hideCalibrationOverlay();
    }
  }

  function cancelDynamicCalibration() {
    if (!state.calibrationRunning) return;
    state.calibrationToken = (state.calibrationToken || 0) + 1;
    state.calibrationMode = false;
    state.calibrationRunning = false;
    setMachineState("idle");
    appendCalibrationLog("calibration_cancelled", {});
    ui.refs.testSoundBtn.disabled = false;
    ui.hideCalibrationOverlay();
  }

  function getFinalGains() {
    const gains = {};
    env.FEATURE_KEYS.forEach(function (key) {
      gains[key] = Number(state.featureState[key].finalGain.toFixed(3));
    });
    return gains;
  }

  function getFinalOffsets() {
    const offsets = {};
    env.FEATURE_KEYS.forEach(function (key) {
      offsets[key] = Number((state.featureState[key].finalOffset || 0).toFixed(3));
    });
    return offsets;
  }

  window.DynamicCalV3 = {
    startDynamicCalibration: startDynamicCalibration,
    runCalibrationRound: runCalibrationRound,
    startCalibrationPhase: startCalibrationPhase,
    finishCalibrationPhase: finishCalibrationPhase,
    collectCalibrationFrame: collectCalibrationFrame,
    applyGainCalibration: applyGainCalibration,
    applyWeightCalibration: applyWeightCalibration,
    normalizeWeights: normalizeWeights,
    smoothWeights: smoothWeights,
    clampGain: clampGain,
    updateOverlayCountdown: updateOverlayCountdown,
    resetRoundBuffers: resetRoundBuffers,
    cancelDynamicCalibration: cancelDynamicCalibration,
    getFinalGains: getFinalGains,
    getFinalOffsets: getFinalOffsets
  };
})();
