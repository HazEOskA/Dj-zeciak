# DJ ZET · djzet.pl

Strona DJ-a i producenta, rozwinięta na podstawie dostarczonego projektu. Zachowany układ: hero, Record Room, Boom Bap, Producer Room, Archive Wall, Live i kontakt. Paleta: czerń, kość słoniowa i czerwień.

## Co zawiera

- Trzy oryginalne wrzuty ZET wymieniane w 27-sekundowym cyklu; krótkie zaniknięcie, przesunięte warstwy i dyskretny rozbłysk postaci. Tryb ograniczonego ruchu pokazuje jeden statyczny znak.
- Poprawione grafiki i nazwy `djzet-*`; dokładny inwentarz, wymiary oraz pochodzenie w `ASSET-PROOF.md`.
- Rafio: mały player z YouTube IFrame API, otwierany kliknięciem płyty. Powiększenie, kolejka, następny/poprzedni utwór, pauza, pozycja, głośność i bezpośrednie linki YouTube / YouTube Music. Player pozostaje zamontowany podczas nawigacji w aplikacji.
- Osiem potwierdzonych filmów. Identyfikatory, miniatury i opisy pochodzą z oficjalnych kanałów Zet Sounds i Major SPZ; źródła w `research/`.
- Booking i współpraca przez przygotowanie wiadomości w aplikacji pocztowej odwiedzającego. Formularze nie udają wysłania wiadomości i nie mają backendu SMTP.
- Tytuły i opisy podstron, canonical, sitemap, robots oraz JSON-LD osoby i usługi DJ-skiej. Docelowa domena: `https://djzet.pl`.
- Lokalne fonty Bebas Neue, Oswald i Caveat wraz z licencjami OFL. Layout nie zależy od dostępności Google Fonts.

## Uruchomienie

Wymagany Node.js 24 (wersja użyta do walidacji) i npm.

```bash
npm ci
npm run dev
```

Istniejący kontrakt deweloperski: port 8080, wszystkie interfejsy. `startup.sh` uruchamia projekt ze swojego katalogu. Gdy środowisko dopuszcza wyłącznie loopback, można użyć `DJZET_DEV_HOST=127.0.0.1 sh startup.sh`.

```bash
npm run typecheck
npm run build
npm run preview:restart
```

Build zachowuje TanStack Start, React, Vite, Tailwind i Nitro oraz istniejący preset Vercel. Nie przebudowano aplikacji na inny framework. Auth i baza danych nie są potrzebne dla tego zakresu.

## Edycja treści

`src/lib/zet.ts` zawiera katalog utworów i profile. Przy dodaniu utworu ustaw prawdziwy `youtubeId`, tytuł, autora, datę, czas i miniaturę. Nie dodawaj niepotwierdzonych koncertów. Formularze używają zweryfikowanego adresu `marcinzetemel@gmail.com` z opisu kanału Zet Sounds.

`src/components/zet/player.tsx` obsługuje player, `hero-mark.tsx` wrzuty, a `src/styles.css` układ i animacje. Ustawienia karty udostępniania są w `src/lib/og/site.json` i `public/og.jpg`.

## Walidacja i publikacja

Wyniki i granice testów są w `VERIFY.md`, a zrzuty w `proof/`. W trakcie testów nie wysyłano wiadomości do artysty. YouTube może odmówić osadzania konkretnego filmu, wymagać logowania albo zablokować odtwarzanie w danym środowisku; player pokazuje wtedy prawdziwy stan błędu i link do oryginalnego filmu.

Publikacja i zmiany DNS nie zostały wykonane. Zakup domeny podał właściciel; aktywnego hostingu, SSL, indeksacji ani pozycji w Google nie należy traktować jako zweryfikowanych. Po podłączeniu domeny należy sprawdzić odtwarzanie filmów na docelowym originie i wysłać sitemapę do Google Search Console. SEO techniczne nie jest gwarancją pozycji.

Wierność wizualną oceniano na zrzutach: zachowano kolejność sekcji, kompozycję i klimat. Nie deklarujemy pikselowej identyczności z referencją; generatywna restauracja zmienia drobne szczegóły. Oryginały i ślad zmian zostały zachowane.
