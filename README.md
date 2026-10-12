# Cas RC Trainingsweek

Mobiele trainingsapp voor het weekschema (Lower / Upper / Full Body) in Cas RC geel-zwart.
Sets aftikken, kg invullen met je vorige gewicht ernaast, rusttimer, uitlegvideo per oefening
en een Stats-pagina met je progressie.

## Bestanden

| Bestand | Wat |
|---|---|
| `index.html` | De pagina |
| `style.css` | Alle opmaak (mobile first) |
| `data.js` | **Het schema.** Oefeningen, sets, reps en spiergroepen |
| `store.js` | Opslag van je gewichten en vinkjes + rekenwerk |
| `stats.js` | De Stats-pagina en grafieken |
| `app.js` | Schema-weergave, navigatie en rusttimer |
| `sw.js` | Zorgt dat de app offline opent na het eerste bezoek |
| `manifest.webmanifest` + `icons/` | Nodig voor "Zet op beginscherm" |

## Online zetten met GitHub Pages

1. Maak op github.com een nieuwe repository, bijvoorbeeld `casrc-training` (Public).
2. Klik **Add file → Upload files** en sleep alle bestanden **én** de map `icons` erin. Klik **Commit changes**.
3. Ga naar **Settings → Pages**. Kies bij *Source* **Deploy from a branch**, branch **main**, map **/ (root)**, en klik **Save**.
4. Na 1 à 2 minuten staat de app op `https://<jouw-gebruikersnaam>.github.io/casrc-training/`.

Update je een bestaande versie? Upload de nieuwe bestanden over de oude heen.

## Op het beginscherm zetten

- **iPhone (Safari):** open de link → deelknop → **Zet op beginscherm**.
- **Android (Chrome):** open de link → menu (⋮) → **Toevoegen aan startscherm** / **App installeren**.

## Vorige keer en PR

Onder elk kg-vakje staat wat je de vorige keer bij die set deed. Tik erop om dat gewicht over te nemen.
Na invullen zie je het verschil (+2,5 / gelijk / −2,5) en **PR** als het je zwaarste gewicht ooit is voor die oefening.

## Stats

- **Algemene kracht:** per oefening wordt je geschatte 1RM (Epley: kg × (1 + reps/30)) vergeleken met je eerste keer. Het gemiddelde daarvan is je krachtindex: 100 = start, 110 = 10% sterker.
- **Volume per week:** kg × reps van alle sets met gewicht.
- **Per spiergroep:** krachtgroei per spiergroep, en aantal sets deze week vs vorige week.
- **Aanwezigheid:** de laatste 8 weken, hoe voller het vakje hoe meer je hebt afgetikt.
- **Per oefening:** grafiek, zwaarste gewicht, geschatte 1RM, groei sinds start en je laatste sessies.

Nog geen gegevens? Kies **Bekijk met voorbeelddata** om te zien hoe het eruitziet. Voorbeelddata wordt nooit opgeslagen.

Let op: reps komen uit het schema. Doe je meer of minder reps, dan klopt de geschatte 1RM iets minder precies.
Oefeningen zonder gewicht (sprongen, band) tellen mee voor sets en aanwezigheid, niet voor kracht.

## Opslag en back-up

- Alles staat alleen op je eigen telefoon (localStorage). Geen account, geen synchronisatie; teamgenoten zien elkaars cijfers niet.
- Vinkjes horen bij een datum, dus elke week begin je met een leeg schema; je gewichten en geschiedenis blijven bewaard.
- Via **Stats → Back-up opslaan** krijg je een `.json`-bestand. Op een nieuwe telefoon laad je dat in met **Back-up inladen**.
- Browsergegevens wissen = je geschiedenis kwijt. Maak dus af en toe een back-up.

## Offline

Na één keer openen met internet werkt alles ook zonder bereik, behalve de "Uitleg"-knoppen (YouTube).

## Nieuw schema?

Pas `data.js` aan. Houd de **namen** van oefeningen gelijk als je hun geschiedenis wilt behouden.
Verhoog daarna in `sw.js` de regel `const VERSION = "v2";` (naar `"v3"` enz.) zodat telefoons de nieuwe versie ophalen.

## Lokaal testen

```
python3 -m http.server 8000
```

en open `http://localhost:8000`.
