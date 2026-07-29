"use strict";

/* ---------- Presets ---------- */
/* left/right are the tone frequencies fed to each ear; the "beat" your
   brain perceives is |left - right|. Bands use standard EEG ranges. */
const PRESETS = [
  { name: "Meditative Theta", left: 110, right: 103, note: "7 Hz beat · classic hemi-sync theta pair" },
  { name: "Focus Gamma", left: 400, right: 432, note: "32 Hz beat · 432 Hz carrier" },
  { name: "Deep Sleep Delta", left: 100, right: 102, note: "2 Hz beat · slow-wave sleep range" },
  { name: "Relaxed Alpha", left: 200, right: 210, note: "10 Hz beat · relaxed, calm focus" },
  { name: "Alert Beta", left: 300, right: 320, note: "20 Hz beat · active, alert thinking" },
];

const BANDS = [
  { max: 4, name: "Delta · deep sleep" },
  { max: 8, name: "Theta · meditation / REM" },
  { max: 13, name: "Alpha · relaxed focus" },
  { max: 30, name: "Beta · alert thinking" },
  { max: 100, name: "Gamma · high-level cognition" },
];

function bandFor(beatHz) {
  if (beatHz < 0.5) return "Sub-delta (below typical range)";
  for (const b of BANDS) if (beatHz < b.max) return b.name;
  return "Above typical brainwave range";
}

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);

const el = {
  playBtn: $("playBtn"),
  playLabel: document.querySelector(".play-label"),
  volume: $("volume"),
  volumeReadout: $("volumeReadout"),
  beatFreq: $("beatFreq"),
  beatBand: $("beatBand"),

  freqLeftSlider: $("freqLeftSlider"),
  freqLeftNum: $("freqLeftNum"),
  freqRightSlider: $("freqRightSlider"),
  freqRightNum: $("freqRightNum"),
  waveLeft: $("waveLeft"),
  waveRight: $("waveRight"),

  oscEnabled: $("oscEnabled"),
  oscHz: $("oscHz"),
  oscBpm: $("oscBpm"),
  oscMs: $("oscMs"),
  oscDepth: $("oscDepth"),
  oscDepthReadout: $("oscDepthReadout"),
  oscShape: $("oscShape"),
  oscLink: $("oscLink"),

  presetGrid: $("presetGrid"),
  scopeCanvas: $("scopeCanvas"),
};

/* ---------- State ---------- */
const state = {
  leftFreq: 400,
  rightFreq: 432,
  waveLeft: "sine",
  waveRight: "sine",
  volume: 15,
  oscEnabled: false,
  oscHz: 1,
  oscDepth: 60,
  oscShape: "sine",
  oscLink: "sync",
  playing: false,
};

/* ---------- Web Audio graph ---------- */
let audioCtx = null;
let masterGain = null;
let compressor = null;
let analyser = null;
let merger = null;

/* Transient nodes, rebuilt every start() since OscillatorNode can only start once. */
let nodes = null;
let scopeRAF = null;

const FREQ_MIN = 30;
const FREQ_MAX = 15000;

function volumeToGain(percent) {
  return Math.pow(percent / 100, 1.7);
}

function ensureContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  merger = audioCtx.createChannelMerger(2);
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0;

  compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -6;
  compressor.knee.value = 6;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;

  merger.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function buildToneChain(freq, waveform, mergerInput) {
  const osc = audioCtx.createOscillator();
  osc.type = waveform;
  osc.frequency.value = freq;

  const toneGain = audioCtx.createGain();
  toneGain.gain.value = 1;

  osc.connect(toneGain);
  toneGain.connect(merger, 0, mergerInput);

  return { osc, toneGain };
}

function start() {
  ensureContext();
  if (audioCtx.state === "suspended") audioCtx.resume();

  const left = buildToneChain(state.leftFreq, state.waveLeft, 0);
  const right = buildToneChain(state.rightFreq, state.waveRight, 1);

  const lfo = audioCtx.createOscillator();
  lfo.type = state.oscShape;
  lfo.frequency.value = state.oscHz;

  const lfoGainL = audioCtx.createGain();
  const lfoGainR = audioCtx.createGain();
  lfoGainL.gain.value = 0;
  lfoGainR.gain.value = 0;

  lfo.connect(lfoGainL);
  lfo.connect(lfoGainR);
  lfoGainL.connect(left.toneGain.gain);
  lfoGainR.connect(right.toneGain.gain);

  nodes = { left, right, lfo, lfoGainL, lfoGainR };

  const now = audioCtx.currentTime;
  left.osc.start(now);
  right.osc.start(now);
  lfo.start(now);

  applyOscillationParams();
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(volumeToGain(state.volume), now, 0.08);

  state.playing = true;
  updatePlayUI();
  startScope();
}

function stop() {
  if (!audioCtx || !nodes) return;
  const now = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(0, now, 0.08);

  const toStop = nodes;
  window.setTimeout(() => {
    try {
      toStop.left.osc.stop();
      toStop.right.osc.stop();
      toStop.lfo.stop();
    } catch (e) {
      /* already stopped */
    }
    toStop.left.osc.disconnect();
    toStop.right.osc.disconnect();
    toStop.left.toneGain.disconnect();
    toStop.right.toneGain.disconnect();
    toStop.lfo.disconnect();
    toStop.lfoGainL.disconnect();
    toStop.lfoGainR.disconnect();
  }, 400);

  nodes = null;
  state.playing = false;
  updatePlayUI();
  stopScope();
}

function updatePlayUI() {
  el.playBtn.setAttribute("aria-pressed", String(state.playing));
  el.playLabel.textContent = state.playing ? "Stop" : "Start";
}

/* ---------- Live parameter updates ---------- */
function applyFrequencies() {
  el.beatFreq.textContent = Math.abs(state.leftFreq - state.rightFreq).toFixed(1);
  el.beatBand.textContent = bandFor(Math.abs(state.leftFreq - state.rightFreq));

  if (!nodes || !audioCtx) return;
  const now = audioCtx.currentTime;
  nodes.left.osc.frequency.setTargetAtTime(state.leftFreq, now, 0.02);
  nodes.right.osc.frequency.setTargetAtTime(state.rightFreq, now, 0.02);
}

function applyWaveforms() {
  if (!nodes) return;
  nodes.left.osc.type = state.waveLeft;
  nodes.right.osc.type = state.waveRight;
}

function applyVolume() {
  el.volumeReadout.textContent = `${state.volume}%`;
  if (!audioCtx || !masterGain || !state.playing) return;
  const now = audioCtx.currentTime;
  masterGain.gain.setTargetAtTime(volumeToGain(state.volume), now, 0.05);
}

function applyOscillationParams() {
  if (!nodes || !audioCtx) return;
  const now = audioCtx.currentTime;

  const depth = state.oscEnabled ? state.oscDepth / 100 : 0;
  const baseline = 1 - depth / 2;
  const lfoAmt = depth / 2;
  const sign = state.oscLink === "antiphase" ? -1 : 1;

  nodes.left.toneGain.gain.setTargetAtTime(baseline, now, 0.01);
  nodes.right.toneGain.gain.setTargetAtTime(baseline, now, 0.01);
  nodes.lfoGainL.gain.setTargetAtTime(lfoAmt, now, 0.01);
  nodes.lfoGainR.gain.setTargetAtTime(lfoAmt * sign, now, 0.01);
  nodes.lfo.frequency.setTargetAtTime(state.oscHz, now, 0.01);
  if (nodes.lfo.type !== state.oscShape) nodes.lfo.type = state.oscShape;
}

/* ---------- Rate linking (Hz / BPM / ms) ---------- */
function setRateFromHz(hz, skip) {
  state.oscHz = hz;
  if (skip !== "hz") el.oscHz.value = round(hz, 2);
  if (skip !== "bpm") el.oscBpm.value = Math.round(hz * 60);
  if (skip !== "ms") el.oscMs.value = Math.round(1000 / hz);
  applyOscillationParams();
}

function round(v, digits) {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/* ---------- UI wiring ---------- */
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function syncFreqLeft(value) {
  const v = clamp(value, FREQ_MIN, FREQ_MAX);
  state.leftFreq = v;
  el.freqLeftSlider.value = v;
  el.freqLeftNum.value = v;
  applyFrequencies();
  highlightActivePreset();
}

function syncFreqRight(value) {
  const v = clamp(value, FREQ_MIN, FREQ_MAX);
  state.rightFreq = v;
  el.freqRightSlider.value = v;
  el.freqRightNum.value = v;
  applyFrequencies();
  highlightActivePreset();
}

el.playBtn.addEventListener("click", () => {
  if (state.playing) stop();
  else start();
});

el.freqLeftSlider.addEventListener("input", (e) => syncFreqLeft(parseFloat(e.target.value)));
el.freqLeftNum.addEventListener("input", (e) => {
  if (e.target.value === "") return;
  syncFreqLeft(parseFloat(e.target.value));
});
el.freqRightSlider.addEventListener("input", (e) => syncFreqRight(parseFloat(e.target.value)));
el.freqRightNum.addEventListener("input", (e) => {
  if (e.target.value === "") return;
  syncFreqRight(parseFloat(e.target.value));
});

el.waveLeft.addEventListener("change", (e) => {
  state.waveLeft = e.target.value;
  applyWaveforms();
});
el.waveRight.addEventListener("change", (e) => {
  state.waveRight = e.target.value;
  applyWaveforms();
});

el.volume.addEventListener("input", (e) => {
  state.volume = parseFloat(e.target.value);
  applyVolume();
});

el.oscEnabled.addEventListener("change", (e) => {
  state.oscEnabled = e.target.checked;
  applyOscillationParams();
});
el.oscHz.addEventListener("input", (e) => {
  if (e.target.value === "") return;
  setRateFromHz(clamp(parseFloat(e.target.value), 0.05, 40), "hz");
});
el.oscBpm.addEventListener("input", (e) => {
  if (e.target.value === "") return;
  const bpm = clamp(parseFloat(e.target.value), 3, 2400);
  setRateFromHz(bpm / 60, "bpm");
});
el.oscMs.addEventListener("input", (e) => {
  if (e.target.value === "") return;
  const ms = clamp(parseFloat(e.target.value), 25, 20000);
  setRateFromHz(1000 / ms, "ms");
});
el.oscDepth.addEventListener("input", (e) => {
  state.oscDepth = parseFloat(e.target.value);
  el.oscDepthReadout.textContent = `${state.oscDepth}%`;
  applyOscillationParams();
});
el.oscShape.addEventListener("change", (e) => {
  state.oscShape = e.target.value;
  applyOscillationParams();
});
el.oscLink.addEventListener("change", (e) => {
  state.oscLink = e.target.value;
  applyOscillationParams();
});

/* ---------- Presets UI ---------- */
function renderPresets() {
  el.presetGrid.innerHTML = "";
  for (const p of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-btn";
    btn.dataset.left = p.left;
    btn.dataset.right = p.right;
    btn.innerHTML = `<span class="preset-name">${p.name}</span><span class="preset-detail">${p.left} Hz / ${p.right} Hz · ${p.note}</span>`;
    btn.addEventListener("click", () => {
      syncFreqLeft(p.left);
      syncFreqRight(p.right);
    });
    el.presetGrid.appendChild(btn);
  }
  highlightActivePreset();
}

function highlightActivePreset() {
  const buttons = el.presetGrid.querySelectorAll(".preset-btn");
  buttons.forEach((btn) => {
    const isActive =
      parseFloat(btn.dataset.left) === state.leftFreq && parseFloat(btn.dataset.right) === state.rightFreq;
    btn.classList.toggle("active", isActive);
  });
}

/* ---------- Scope ---------- */
function startScope() {
  const canvas = el.scopeCanvas;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 900;
  const cssHeight = canvas.clientHeight || 140;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  ctx.scale(dpr, dpr);

  const bufferLength = analyser.fftSize;
  const data = new Uint8Array(bufferLength);

  function draw() {
    scopeRAF = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(data);

    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#7c9eff";
    ctx.beginPath();

    const sliceWidth = cssWidth / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = data[i] / 128.0;
      const y = (v * cssHeight) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();
  }
  draw();
}

function stopScope() {
  if (scopeRAF) cancelAnimationFrame(scopeRAF);
  scopeRAF = null;
  const canvas = el.scopeCanvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/* ---------- Init ---------- */
function init() {
  renderPresets();
  syncFreqLeft(state.leftFreq);
  syncFreqRight(state.rightFreq);
  applyVolume();
  setRateFromHz(state.oscHz);
  el.oscDepthReadout.textContent = `${state.oscDepth}%`;
}

init();
