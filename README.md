# Thought Cards: prototype 1.0.0

*Get it out of your head. I’ll remember it.*

Mobiel webprototype in gewone HTML, CSS en JavaScript. Geen framework, geen build, geen backend.

## Bestanden

| Bestand | Inhoud |
|---|---|
| `index.html` | Schermen, sheets, navigatie en de inline SVG-iconenset |
| `styles.css` | Design tokens (CSS custom properties), layout, animaties, dark mode, reduced motion |
| `app.js` | Alle logica, in 16 genummerde secties (state, storage, cleanup, gestures, speech …) |
| `manifest.webmanifest` | PWA-gegevens (naam, kleuren, iconen) |
| `service-worker.js` | Offline-cache van de eigen statische bestanden |
| `assets/` | App-iconen (192, 512, maskable 512, Apple touch icon, SVG-favicon) |

## Lokaal openen

Gebruik een kleine lokale webserver (dubbelklikken op `index.html` werkt ook, maar dan doen de service worker en soms de microfoon niet mee):

```bash
cd thought-cards
python3 -m http.server 8000
```

Open daarna `http://localhost:8000`. In Chrome DevTools kun je met de device toolbar een iPhone-formaat kiezen.

## Online zetten via GitHub Pages

1. Maak een repository aan en zet de inhoud van deze map in de root.
2. Ga naar **Settings → Pages**.
3. Kies bij *Source* **Deploy from a branch**, branch `main`, map `/ (root)`, en klik **Save**.
4. Na een minuut staat de app op `https://<gebruikersnaam>.github.io/<repository>/`.

Alle paden zijn relatief, dus de app werkt ook onder zo’n `/repository/`-subpad. Netlify en Cloudflare Pages werken ook: map uploaden, geen buildcommando nodig.

## Op het beginscherm zetten

- **iPhone (Safari):** open de HTTPS-link → deelknop → *Zet op beginscherm*.
- **Android (Chrome):** open de link → menu ⋮ → *App installeren* of *Toevoegen aan startscherm*.

## Opslag

- Gedachten: `localStorage` onder `thoughtCards.thoughts`
- Instellingen: `thoughtCards.settings`
- Eigen plekken: `thoughtCards.places`
- Niet-opgeslagen invoer op het Capture-scherm: `thoughtCards.draft`

Alles blijft in déze browser op dít apparaat. Er is geen account en geen synchronisatie. Site-data wissen wist ook de Thought Bank. Een geïnstalleerde app op iOS heeft een eigen opslag, los van Safari.

Beschadigde opgeslagen data laat de app niet crashen: de ruwe tekst wordt als `…backup-<tijd>` bewaard en de app start met een lege lijst. Ontbrekende velden worden aangevuld door `normalizeThought()`.

**Voorbeelddata:** bovenaan `app.js` staat `const USE_DEMO_DATA = true;`. Zet hem op `false` om zonder voorbeeldgedachten te starten. Voorbeelden worden alleen toegevoegd als er nog nooit gedachten zijn opgeslagen.

## Afgeronde gedachten

`cleanupCompletedThoughtsFromPreviousDays()` verwijdert een Done-gedachte zodra de lokale kalenderdag van `completedAt` vóór vandaag ligt. Hij draait bij opstarten, bij `visibilitychange`, bij `focus`, bij terugkeren uit de bfcache, vóór elke render van de Thought Bank en elke 20 seconden (dus ook als middernacht passeert terwijl de app openstaat).

## Testhulp in de console

```js
thoughtCardsDebug.backdateCompleted()  // zet Done-gedachten op gisteren 23:50, herlaad daarna
thoughtCardsDebug.triggerReminder()    // laat een reminder nu afgaan (in-app melding)
thoughtCardsDebug.thoughts()           // kopie van alle gedachten
thoughtCardsDebug.resetAll()           // alles wissen en herladen
```

## Offline

Na het eerste bezoek via HTTPS (of localhost) opent de app ook zonder internet: schermen, opslaan, zoeken, Done en verwijderen werken gewoon. Offline valt het lettertype Outfit terug op het systeemlettertype, en spraak werkt in de meeste browsers niet zonder netwerk. Bij een nieuwe versie: verhoog `CACHE_VERSION` in `service-worker.js`.

## Wat gesimuleerd of beperkt is

- **Reminders:** verschijnen als in-app melding (“A gentle nudge”) zolang de app open is. Echte achtergrondnotificaties zijn in een webapp niet betrouwbaar; de data (`date`, `time`, `notifiedAt`) is opgezet om later in React Native lokale notificaties te plannen.
- **Locaties:** Home, Office, Laundromat en de lijst in *Find a location* zijn voorbeeldplekken. Zoeken filtert je eigen plekken en laat je een nieuwe naam toevoegen; er is geen echte adreszoeker of geofencing. *Use my current location* gebruikt wel echt `navigator.geolocation` (alleen via HTTPS).
- **Spraak:** gebruikt de Web Speech API. Werkt in Chrome (Android/desktop) en Safari (iOS 14.5+); niet in Firefox. In een op het beginscherm geïnstalleerde iOS-app kan spraak ontbreken; dan verschijnt een vriendelijke melding en kun je gewoon typen.
- **Daily Review** (het zonnetje in het menu) is een placeholder.
