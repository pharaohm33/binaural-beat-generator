# Binaural Beat Generator

A dependency-free, client-side dual-channel frequency generator for binaural-beat
experimentation. Built with the Web Audio API — no backend, no build step.

**Live demo:** https://pharaohm33.github.io/binaural-beat-generator/

## Features

- Independent left-ear / right-ear tone generators, **30 Hz – 15,000 Hz**, true
  stereo separation via a `ChannelMergerNode` (not panning) so each ear gets its
  own signal.
- Per-ear waveform choice (sine, triangle, sawtooth, square).
- Master volume control with click-free ramping.
- **Amplitude oscillation** ("wave"/pulse effect) — an LFO modulates loudness at a
  rate you can set in **Hz, BPM, or ms period** (all three stay in sync). Depth,
  waveform shape (smooth sine, isochronic square, triangle), and a sync/antiphase
  mode (pulse together vs. alternate L/R) are all adjustable live.
- Nine presets grouped into the five EEG bands (Delta/Theta/Alpha/Beta/Gamma), each
  section labeled with its Hz range and what it's typically used for (sleep,
  meditation, relaxed focus, concentration, high-level cognition) — including the
  two hemi-sync-style pairs this was built for, **400/432 Hz** (Gamma) and
  **110/103 Hz** (Theta).
- Live beat-frequency readout with brainwave-band classification.
- Built-in oscilloscope (`AnalyserNode` + canvas).
- A gentle `DynamicsCompressorNode` safety limiter on the master output.

## Usage

Headphones are required — the left/right separation only works over stereo
headphones, not speakers.

Open `index.html` directly, or serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploying

This is a static site — any static host works. It's set up to deploy for free via
**GitHub Pages** (Settings → Pages → Deploy from branch → `main` / `/ (root)`).

## Disclaimer

For personal audio-engineering experimentation. Not a medical device, not medical
advice. Start at low volume. If you have epilepsy, a heart condition, or are
pregnant, consult a doctor before use.

## License

MIT
