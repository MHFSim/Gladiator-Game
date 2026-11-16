# Sanguis et Gloria

Brutales Gladiatoren-PvP für den Handy-Browser, gespielt im Querformat.
Gebaut mit [Babylon.js 9](https://www.babylonjs.com), läuft komplett über GitHub Pages.

**Spielen:** https://mhfsim.github.io/Gladiator-Game/

## Stand: Phase 0 + erster Kampf

- Ludus von Capua, komplett im Code erzeugt: Arena mit bemalter Podiumsmauer, zwei Tore mit Fallgitter,
  acht Sitzstufen, Säulengang mit Ziegeldach, Fahnen, Trainingspfähle, Waffengestell, vier Feuerbecken,
  Zypressen und der rauchende Vesuv am Horizont.
- Physikalischer Himmel, Sonne mit weichen Schatten, Dunst, Staub in der Luft, Tageszeit 6–20:30 Uhr
  (im Menü einstellbar). Abends und nachts beleuchten die Feuerbecken die Arena.
- Murmillo mit Helm (Kamm, Federbusch, Gittervisier), bemaltem Scutum, Gladius, Manica, Beinschiene und Gürtel.
- 29 Motion-Capture-Animationen, Bewegungen werden weich überblendet, der Schildarm hält den Schild auch beim Laufen.
- Trainingspartner (blau), der näher kommt, angreift, blockt, getroffen wird, fällt und wieder aufsteht.
- Blut, Funken, Blutflecken im Sand, Kamerawackeln und kurzer Bildstopp bei Treffern.
- Zwei Steuerungen (Einstellungen ⚙): **A** Stick + Gesten, **B** Stick + Tasten.
- Qualitätsstufen mit automatischer Auflösungsanpassung, Akku-Modus (30 FPS), WebGPU optional.
- Installierbar als Web-App („Zum Home-Bildschirm“) für Vollbild.

## Steuerung

| Aktion | Schema A: Gesten | Schema B: Tasten |
| --- | --- | --- |
| Laufen | Linker Daumen ziehen | Linker Daumen ziehen |
| Kamera | Rechter Daumen ziehen | Rechter Daumen ziehen |
| Leichter Schlag (Kombo) | Rechts tippen | „Schlag“ tippen |
| Schwerer Schlag | Rechts halten | „Schlag“ halten |
| Block | Zwei Finger rechts halten | „Schild“ halten |
| Rolle | Rechts zur Seite / nach unten wischen | „Rolle“ |
| Schildstoß | Rechts nach oben wischen | „Faust“ |

## Entwickeln

```bash
npm install
npm run dev        # lokaler Server, im WLAN auch vom Handy erreichbar
npm run build      # Produktions-Build nach dist/
```

Jeder Push auf `main` wird per GitHub Actions gebaut und auf GitHub Pages veröffentlicht.

### Assets neu erzeugen

Die Original-Pakete von Quaternius (CC0) sind zu groß fürs Repo. Zum Neubauen die drei ZIPs
(Universal Base Characters, Universal Animation Library 1 und 2, jeweils „Standard“) entpacken und:

```bash
npm run assets -- <Ordner mit den entpackten Paketen>
```

## Aufbau

```text
src/
  arena/capua.ts        Arena des Ludus von Capua (prozedural)
  core/                 Engine, Qualitätsstufen, Einstellungen
  game/                 Spiellogik, Kamera, Treffer-Effekte
  gladiators/           Figur laden, Ausrüstung bauen, Animations-Ebenen
  input/touch.ts        Touch-Steuerung (beide Schemata)
  render/               Himmel, Licht, Schatten, Texturen, Geometrie-Baukasten
  ui/hud.ts             HUD und Einstellungen
tools/                  Asset-Pipeline und Screenshot-Werkzeug
```

## Lizenz

Code: MIT (siehe `LICENSE`). Figuren und Animationen: CC0 von Quaternius (siehe `CREDITS.md`).
