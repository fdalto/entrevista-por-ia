(function () {
  const FEATURE_KEYS = ["vol", "low", "move", "cent", "zcr"];

  const BAR_NAMES = ["VOLx20", "LOW", "MOVE", "CENT", "SPEECH", "PITCH", "ROLLOFF", "CHANGE"];

  const BASE_GAINS = {
    vol: 1,
    low: 1,
    move: 5,
    cent: 15,
    zcr: 1
  };

  const BASE_SPEECH_WEIGHTS = {
    vol: 0.45,
    low: 0.28,
    move: 0.17,
    cent: 0.05,
    zcr: 0.05
  };

  const GAIN_LIMITS = {
    vol: { min: 0.5, max: 4 },
    low: { min: 0.5, max: 4 },
    move: { min: 1, max: 20 },
    cent: { min: 3, max: 30 },
    zcr: { min: 0.5, max: 3 }
  };

  const OFFSET_LIMITS = {
    vol: { min: -80, max: 80 },
    low: { min: -80, max: 80 },
    move: { min: -80, max: 80 },
    cent: { min: -80, max: 80 },
    zcr: { min: -80, max: 80 }
  };

  const CALIBRATION_TIMINGS = {
    silenceMs: 3000,
    aaaaMs: 1500,
    dynamicMs: 4000
  };

  const CONFIDENCE_THRESHOLDS = {
    speechHigh: 55,
    silenceLow: 18
  };

  const CALIBRATION_STEP_LABELS = {
    silence: "Silencio",
    aaaa: "DIGA AAAAAAAAAA por 1,5 segundos",
    dynamic: "Fale normalmente"
  };

  const CALIBRATION_TARGETS = {
    nonSpeechMax: 15,
    targetSilence: 10,
    targetAaaa: 60,
    speechIdeal: 70
  };

  const CONFIG = {
    FRAME_MS: 50,
    SMOOTH_N: 5,
    HISTORY_MAX: 120,
    CUT_SUSTAIN_BLOCKS: 6,
    SWITCH_SUSTAIN_BLOCKS: 4,
    CUT_FLASH_MS: 300,
    SWITCH_FLASH_MS: 300,
    SWITCH_SCORE_THRESHOLD: 17,
    SWITCH_LOCAL_SHIFT_THRESHOLD: 14,
    SPEECH_ON_THRESHOLD: 38,
    SPEECH_OFF_THRESHOLD: 24
  };

  const APP_STATE = {
    recording: false,
    calibrationMode: false,
    calibrationRunning: false,
    calibrationRound: 0,
    calibrationPhase: "idle",
    calibrationStateMachine: "idle",
    ctx: null,
    analyser: null,
    source: null,
    streamRef: null,
    processingTimer: null,
    rafId: null,
    freqData: null,
    timeData: null,
    prevSpectrum: null,
    rawFrames: [],
    smoothFrames: [],
    lastCutFlashAt: 0,
    lastSwitchFlashAt: 0,
    calibrationToken: 0,
    featureState: {
      vol: { baseGain: BASE_GAINS.vol, dynamicGain: 1, finalGain: BASE_GAINS.vol, dynamicOffset: 0, finalOffset: 0 },
      low: { baseGain: BASE_GAINS.low, dynamicGain: 1, finalGain: BASE_GAINS.low, dynamicOffset: 0, finalOffset: 0 },
      move: { baseGain: BASE_GAINS.move, dynamicGain: 1, finalGain: BASE_GAINS.move, dynamicOffset: 0, finalOffset: 0 },
      cent: { baseGain: BASE_GAINS.cent, dynamicGain: 1, finalGain: BASE_GAINS.cent, dynamicOffset: 0, finalOffset: 0 },
      zcr: { baseGain: BASE_GAINS.zcr, dynamicGain: 1, finalGain: BASE_GAINS.zcr, dynamicOffset: 0, finalOffset: 0 }
    },
    speechWeights: {
      vol: BASE_SPEECH_WEIGHTS.vol,
      low: BASE_SPEECH_WEIGHTS.low,
      move: BASE_SPEECH_WEIGHTS.move,
      cent: BASE_SPEECH_WEIGHTS.cent,
      zcr: BASE_SPEECH_WEIGHTS.zcr
    },
    calibrationBuffers: null,
    calibrationLogs: [],
    lastDebug: {}
  };

  function createRoundBuffers() {
    return {
      raw: [],
      smooth: [],
      trustedSpeech: [],
      trustedSilence: [],
      trustedAaaa: [],
      features: {
        vol: { speech: [], silence: [], aaaa: [] },
        low: { speech: [], silence: [], aaaa: [] },
        move: { speech: [], silence: [], aaaa: [] },
        cent: { speech: [], silence: [], aaaa: [] },
        zcr: { speech: [], silence: [], aaaa: [] }
      }
    };
  }

  APP_STATE.calibrationBuffers = createRoundBuffers();

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function avg(arr) {
    if (!arr || !arr.length) return 0;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }

  function avgKey(arr, key) {
    if (!arr || !arr.length) return 0;
    return avg(arr.map(function (x) { return x[key]; }));
  }

  function percentile(arr, p) {
    if (!arr || !arr.length) return 0;
    const sorted = arr.slice().sort(function (a, b) { return a - b; });
    const idx = (sorted.length - 1) * p;
    const low = Math.floor(idx);
    const high = Math.ceil(idx);
    if (low === high) return sorted[low];
    const ratio = idx - low;
    return sorted[low] * (1 - ratio) + sorted[high] * ratio;
  }

  function median(arr) {
    return percentile(arr, 0.5);
  }

  function nowMs() {
    return performance.now();
  }

  window.AppEnv = {
    FEATURE_KEYS: FEATURE_KEYS,
    BAR_NAMES: BAR_NAMES,
    BASE_GAINS: BASE_GAINS,
    BASE_SPEECH_WEIGHTS: BASE_SPEECH_WEIGHTS,
    GAIN_LIMITS: GAIN_LIMITS,
    OFFSET_LIMITS: OFFSET_LIMITS,
    CALIBRATION_TIMINGS: CALIBRATION_TIMINGS,
    CALIBRATION_STEP_LABELS: CALIBRATION_STEP_LABELS,
    CALIBRATION_TARGETS: CALIBRATION_TARGETS,
    CONFIDENCE_THRESHOLDS: CONFIDENCE_THRESHOLDS,
    CONFIG: CONFIG,
    APP_STATE: APP_STATE,
    createRoundBuffers: createRoundBuffers,
    clamp: clamp,
    avg: avg,
    avgKey: avgKey,
    percentile: percentile,
    median: median,
    nowMs: nowMs
  };
})();
