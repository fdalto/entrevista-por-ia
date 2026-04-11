(function () {
  const env = window.AppEnv;
  const BAR_NAMES = env.BAR_NAMES;

  const refs = {
    recordBtn: document.getElementById("recordBtn"),
    testSoundBtn: document.getElementById("testSoundBtn"),
    cutEl: document.getElementById("cut"),
    switchEl: document.getElementById("switch"),
    barsEl: document.getElementById("bars"),
    logEl: document.getElementById("log"),
    canvas: document.getElementById("scope"),
    overlay: document.getElementById("calibrationOverlay"),
    overlayRound: document.getElementById("overlayRound"),
    overlayStepSilence: document.getElementById("overlayStepSilence"),
    overlayStepAaaa: document.getElementById("overlayStepAaaa"),
    overlayStepDynamic: document.getElementById("overlayStepDynamic"),
    overlayCountdown: document.getElementById("overlayCountdown"),
    overlaySubstatus: document.getElementById("overlaySubstatus")
  };

  const cctx = refs.canvas.getContext("2d");

  function createBars() {
    refs.barsEl.innerHTML = "";
    BAR_NAMES.forEach(function (name) {
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
      refs.barsEl.appendChild(wrap);
    });
  }

  function updateBars(values) {
    const fills = document.querySelectorAll(".fill");
    values.forEach(function (v, i) {
      if (fills[i]) fills[i].style.height = env.clamp(v, 0, 100) + "%";
    });
  }

  function updateLog(data) {
    refs.logEl.textContent = JSON.stringify(data, null, 2);
  }

  function flashIndicator(el, ms) {
    el.classList.remove("active");
    void el.offsetWidth;
    el.classList.add("active");
    setTimeout(function () {
      el.classList.remove("active");
    }, ms || 300);
  }

  function clearIndicators() {
    refs.cutEl.classList.remove("active");
    refs.switchEl.classList.remove("active");
  }

  function drawScope(freqData) {
    cctx.clearRect(0, 0, refs.canvas.width, refs.canvas.height);
    cctx.beginPath();

    for (let i = 0; i < freqData.length; i++) {
      const v = freqData[i] / 255;
      const x = (i / freqData.length) * refs.canvas.width;
      const y = refs.canvas.height - v * refs.canvas.height;

      if (i === 0) cctx.moveTo(x, y);
      else cctx.lineTo(x, y);
    }

    cctx.stroke();
  }

  function showCalibrationOverlay() {
    refs.overlay.classList.remove("hidden");
  }

  function hideCalibrationOverlay() {
    refs.overlay.classList.add("hidden");
  }

  function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return mm + ":" + ss;
  }

  function updateOverlayCountdown(ms) {
    refs.overlayCountdown.textContent = formatCountdown(ms);
  }

  function updateCalibrationOverlay(info) {
    refs.overlayRound.textContent = info.roundLabel || "RODADA 0/3";
    setActiveCalibrationStep(info.activeStep || null);
    refs.overlaySubstatus.textContent = info.substatus || "-";
    updateOverlayCountdown(info.countdownMs || 0);
  }

  function setActiveCalibrationStep(stepKey) {
    const map = {
      silence: refs.overlayStepSilence,
      aaaa: refs.overlayStepAaaa,
      dynamic: refs.overlayStepDynamic
    };

    Object.keys(map).forEach(function (key) {
      map[key].classList.toggle("active", key === stepKey);
    });
  }

  createBars();

  window.RenderV3 = {
    refs: refs,
    createBars: createBars,
    updateBars: updateBars,
    updateLog: updateLog,
    flashIndicator: flashIndicator,
    clearIndicators: clearIndicators,
    drawScope: drawScope,
    showCalibrationOverlay: showCalibrationOverlay,
    hideCalibrationOverlay: hideCalibrationOverlay,
    updateOverlayCountdown: updateOverlayCountdown,
    updateCalibrationOverlay: updateCalibrationOverlay,
    setActiveCalibrationStep: setActiveCalibrationStep
  };
})();
