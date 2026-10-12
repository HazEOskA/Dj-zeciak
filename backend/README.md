# DJ ZET — Project API V1 (lokalny backend)

Node.js 22+ bez zewnętrznych zależności. Silnik audio działa **lokalnie** w przeglądarce; serwer przechowuje tylko projekty i stan miksera, nie przesyła ani nie odtwarza strumieni audio.

## Uruchomienie

```bash
cd backend
export DJZET_API_TOKEN="<losowy-token-minimum-24-znaki>"
export DJZET_DB_PATH="./data/djzet.sqlite"
export DJZET_ALLOWED_ORIGIN="http://localhost:5173"
npm test
npm start
```

Domyślnie serwer nasłuchuje na `127.0.0.1:8787`. Wersja Node 22 może emitować ostrzeżenie eksperymentalnego `node:sqlite`; preferowany Node 24.

## API

- `GET /healthz` — kontrola życia, publiczna.
- `GET /api/v1/projects` — lista metadanych.
- `POST /api/v1/projects` — `{"name":"...","state":{"decks":[],"mixer":{}}}`.
- `GET /api/v1/projects/:id` — zapisany snapshot.
- `PUT /api/v1/projects/:id` — nowy snapshot; wymagany nagłówek `If-Match: <revision>`.
- `DELETE /api/v1/projects/:id` — usuń; wymagany `If-Match: <revision>`.

Każdy `/api/v1/*` wymaga `Authorization: Bearer <DJZET_API_TOKEN>`. Niewłaściwa rewizja = HTTP 409. Brak rewizji = HTTP 428. Maksymalny request 64 KiB, stan 48 KiB. Token nie może trafić do publicznego JS frontendu; przed publicznym uruchomieniem trzeba zbudować logowanie sesyjne użytkowników i uprawnienia do projektów.

## Granice bezpieczeństwa i skali

- SQLite single-instance: nadaje się do lokalnego pilotu / VPS, **nie** do autoskalowania wielu kontenerów z oddzielnymi dyskami.
- Brak kont, nie ma systemu uprawnień per użytkownik. Nie wystawiać tej wersji API publicznie z administracyjnym tokenem współdzielonym przez przeglądarki.
- Snapshot stanu pozwala zapisać projekt, ale frontend nie jest jeszcze podłączony do API. Media pozostają na urządzeniu DJ-a.
- W chmurze docelowo PostgreSQL + sesje użytkowników + migracje + audyt + rate limiting, bez naruszania silnika Web Audio.