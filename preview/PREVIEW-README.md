# DJ ZET — Performance Station V2

## Cel
Przeglądarkowa, czterokanałowa konsola inspirowana ergonomią profesjonalnych kontrolerów (referencja układu funkcjonalnego: Pioneer DJ DDJ-FLX10). Autorska implementacja DJ ZET, nie emulacja firmware i nie oficjalny produkt Pioneer.

## Zakres działający w kodzie
- 4 niezależne źródła lokalnych plików audio i 4 tory Web Audio API, fizyczne decki z warstwami 1/3 i 2/4.
- Import własnych MP3/WAV i innych formatów obsługiwanych przez przeglądarkę (limit 100 MB).
- PLAY, PAUSE, CUE, SET CUE, 8 HOT CUE na deck, pętla 4 beat, jog seek, waveform ze wskazaniem pozycji.
- 4 × LOW / MID / HIGH EQ, filtr na kanał, 4 fadery, master, equal-power crossfader A/B.
- Echo FX z regulacją WET, 8 padów samplera z syntezowanymi one-shotami i importem do 8 własnych próbek (do 15 MB każda).
- BPM manual / TAP i SYNC przez playbackRate; obsługa urządzeń dotykowych.
- Wyłącznie lokalne przetwarzanie: bez serwera do uploadu utworów.

## Granice rozwiązania
- Brak automatycznej detekcji BPM, time-stretch / key lock, mapowania sprzętowego MIDI/HID, DJ stems, nagrywania setów i trwałej biblioteki po odświeżeniu.
- SYNC reguluje prędkość odtwarzania, zmienia więc także wysokość dźwięku.
- Obsługiwane formaty zależą od kodeków przeglądarki; odsłuch potwierdzi użytkownik na swoim urządzeniu.
- Przygotowane testy UI w `preview/tests/tests.json`. Status wdrożenia i QA w AppDeploy, nie zastępują subiektywnego testu audio.
- NIE ZMIENIAĆ produkcji ani DNS bez osobnej zgody.

## Rozwój
Katalog `preview/` na branchu `preview/dj-console-slice1`. Aplikacja HTML + TypeScript + CSS w Vite.

```bash
cd preview
npm ci
npm run build
npm run dev
```

Preview: https://dj-zet-dj-console-slice-1-preview-53i3v8.v2.appdeploy.ai/
