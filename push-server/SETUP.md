# Reminder-server instellen (± 15 minuten, gratis)

Deze server stuurt je **tijdreminders** en je **dagelijkse recap** naar het lockscreen van je telefoon, ook als de app dicht is. Hij draait gratis op Cloudflare. Je hebt geen command line nodig: alles gaat via de website van Cloudflare.

> Cloudflare past zijn dashboard soms wat aan. Heten knoppen net iets anders, zoek dan naar het vetgedrukte woord.

---

## Stap 1 · Cloudflare-account

Maak een gratis account aan op **dash.cloudflare.com** en log in.

## Stap 2 · Database aanmaken

1. Ga in het linkermenu naar **Storage & Databases → D1 SQL Database**.
2. Klik **Create** (of *Create database*).
3. Naam: `thought-cards`. Klik **Create**.

Tabellen hoef je niet aan te maken; de server doet dat zelf.

## Stap 3 · Worker aanmaken

1. Ga naar **Workers & Pages** → **Create** → **Create Worker** (het "Hello World"-voorbeeld is prima).
2. Naam: `thought-cards-push`. Klik **Deploy**.
3. Klik **Edit code**. Verwijder alles in de editor en plak de **volledige inhoud van `worker.js`** uit deze map.
4. Klik rechtsboven **Deploy**.

## Stap 4 · Database koppelen

1. Open je worker `thought-cards-push` → tabblad **Bindings** (soms onder *Settings → Bindings*).
2. **Add binding** → **D1 database**.
3. Variable name: **`DB`** (precies zo, hoofdletters). Database: `thought-cards`.
4. Opslaan / **Deploy**.

## Stap 5 · Elke minuut laten draaien

1. In je worker: **Settings → Trigger Events** (of *Triggers*) → **Add** → **Cron Triggers**.
2. Kies *Custom* en vul in: `* * * * *` (vijf sterretjes = elke minuut).
3. Opslaan.

## Stap 6 · Controleren

Open het adres van je worker in je browser. Je vindt het bovenaan de workerpagina, bijvoorbeeld:

`https://thought-cards-push.jouwnaam.workers.dev`

Zie je iets als `{"ok":true,"service":"Thought Cards push server","devices":0,...}`, dan werkt alles. Zie je *Database not connected yet*, controleer dan stap 4.

## Stap 7 · App aan de server koppelen

1. Open `app.js` in je GitHub-repository (potloodje = bewerken).
2. Zet bovenaan je worker-adres in, **zonder** `/` aan het eind:

   ```js
   const PUSH_SERVER_URL = 'https://thought-cards-push.jouwnaam.workers.dev';
   ```
3. **Commit changes**. Na ongeveer een minuut staat de nieuwe versie op GitHub Pages.

## Stap 8 · Op je iPhone

1. Open je GitHub Pages-link in **Safari**.
2. Deelknop → **Zet op beginscherm**.
3. Open **Thought Cards vanaf je beginscherm** (niet via Safari).
4. Ga naar **Settings** → tik **Turn on** onder Notifications → **Sta toe**.
5. Open **Daily recap** en tik **Send me a test**. Binnen enkele seconden zie je een melding.

Klaar. Stel bij Daily recap per dag je tijd in en zet reminders op je gedachten.

> Een app op je beginscherm heeft op iPhone een eigen opslag. Gedachten die je eerder in Safari bewaarde, zie je daar niet.

---

## Optioneel

**Variabelen** (worker → *Settings → Variables and Secrets*):

| Naam | Waarde | Waarom |
|---|---|---|
| `VAPID_SUBJECT` | `mailto:jij@voorbeeld.nl` | Contactadres dat meegaat met elke push. Aanbevolen. |
| `ALLOWED_ORIGIN` | `https://jouwnaam.github.io` | Alleen jouw app mag de server aanroepen. |

**Met de command line (wrangler):** zet je database-id in `wrangler.toml` en draai `npx wrangler deploy`.

## Goed om te weten

- **Kosten:** het gratis Cloudflare-plan is ruim genoeg voor persoonlijk gebruik (één run per minuut is 1.440 per dag).
- **Wat staat er op de server?** De tekst van je gedachten, de reminder-tijden, je recap-schema en je tijdzone. Zet je Notifications uit in de app, dan wordt die kopie verwijderd.
- **Geen geheimen in deze map:** de sleutels maakt de server zelf aan en bewaart ze in je eigen database. `worker.js` mag dus gewoon openbaar in je repository staan.
- **Locatiemeldingen** ("als ik thuiskom") blijven in een webapp niet mogelijk. Daarvoor is een native app nodig.
