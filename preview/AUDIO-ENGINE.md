# DJ ZET — SILNIK AUDIO / SLICE A

**Branch:** `feature/djzet-flx10-engine`
**Źródło interfejsu:** `preview/dj-console-slice1`

## Architektura
`src/audio/dsp.ts` — matematyka audio, niezależna od DOM.
`src/audio/mixer.ts` — lokalny silnik routingu sygnału Web Audio API.
`src/main.ts` — istniejący interfejs sterujący silnikiem.

```
4 × <audio> → EQ (low/mid/high) → filter → channel gain → analyser
  deck 1 / 3 → bus A (equal-power) ┐
  deck 2 / 4 → bus B (equal-power) ├→ MASTER → compressor → meter → głośniki
                                   └→ FX send → delay → MASTER
                                         MASTER → MediaRecorder
```

**Co działa w kodzie:** 4 torów, EQ ±12 dB, regulowane LP/HP, fader, crossfader equal-power, master, echo, analizatory oraz start/stop i eksport nagrania miksu z przycisku w UI. Odtwarzanie plików pozostaje lokalne.

**Granice:** Scratch nadal tylko seek (nie vinyl emulation); automatyczna detekcja BPM, key lock/time-stretch, STEMS i MIDI/HID jeszcze nie istnieją. Odsłuch i sprzętowy test opóźnień pozostają do zweryfikowania. Funkcje z DDJ-FLX10 są referencją wymagań, nie deklaracją osiągnięcia 1:1.

## Testy
```bash
cd preview
npm install
npm run typecheck
npm run test:audio
npm run build
```

Testy z `tests/audio-engine.test.mjs` obejmują matematyczne i strukturalne kontrakty DSP w mockowym `AudioContext`. Nie zastępują pomiaru odsłuchu, testu latencji, ani E2E rzeczywistych plików.

**Brak mutacji:** `main`, produkcja, domena, istniejący preview AppDeploy.
