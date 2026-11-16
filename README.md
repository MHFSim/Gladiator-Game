# Sanguis et Gloria

Brutales Gladiatoren-PvP für den Handy-Browser, gespielt im Querformat.
Gebaut mit [Babylon.js 9](https://www.babylonjs.com), läuft komplett über GitHub Pages.

**Spielen:** https://mhfsim.github.io/Gladiator-Game/

## Stand: Phase 3 – Publikum, Wetter, Kolosseum (in Arbeit)

**Arena und Grafik (Phase 0)**
- Ludus von Capua, komplett im Code erzeugt: bemalte Podiumsmauer, zwei Tore mit Fallgitter, Sitzstufen,
  Säulengang mit Ziegeldach, Fahnen, Trainingspfähle, Waffengestell, Feuerbecken, Zypressen, rauchender Vesuv.
- Physikalischer Himmel, Sonne mit weichen Schatten, Dunst, Staub, Tageszeit 6–20:30 Uhr im Menü.
- Murmillo mit Helm, Federbusch, Gittervisier, bemaltem Scutum, Gladius, Manica, Beinschiene, Gürtel.

**Kampf (Phase 1)**
- Deckung oben, links, rechts. Geblockt wird automatisch, wenn die eigene Deckung (gold) zur Angriffsseite (rot) passt.
- Leichte und schwere Angriffe aus allen drei Richtungen, Kombos, Finten (schweren Angriff abbrechen).
- Parade im letzten Moment: Gegner taumelt, du darfst kontern.
- Deckung brechen mit dem Schild, Ausweichrolle mit Unverwundbarkeit, Ausdauer und Erschöpfung.
- Trefferzonen Kopf, Rumpf, Waffenarm, Bein mit Rüstung (Helm, Manica, Beinschiene) und Folgen (schwächer, langsamer).
- Aufschalten mit Kamera, die beide Kämpfer zeigt. Beim Seitwärts- und Rückwärtsgehen drehen sich die Beine,
  der Oberkörper bleibt zum Gegner gerichtet.
- KI-Gegner in fünf Stufen (Rekrut bis Primus Palus) mit menschlicher Reaktionszeit, Paraden, Finten, Schildstößen.
- Runden mit Spielstand, Blut, Funken, Blutflecken im Sand, Bildstopp und Kamerawackeln.
- Alle Kampfwerte in `src/data/combat.json`.

**Mehrspieler (Phase 2)**
- Hauptmenü: Training gegen die KI, Arena eröffnen, Arena beitreten.
- Gastgeber bekommt einen 6-stelligen Code, QR-Code und einen Link zum Teilen.
- Verbindung direkt zwischen den Handys (WebRTC über Trystero), kein eigener Server.
- Das Handy des Gastgebers entscheidet über alle Treffer, Paraden und Blocks; der Gast sieht dasselbe mit kurzer Verzögerung.
- Verlässt der Gast die Arena, kämpft der Gastgeber gegen die KI weiter.
- Test ohne Internet: zwei Tabs mit `?net=local` (siehe `tools/net-test.mjs`).

**Dein Gladiator (Ludus)**
- Im Hauptmenü: Name, Stufe 1 bis 50, Erfahrungsbalken, Siege und Niederlagen.
- Erfahrung gibt es nur für Siege (ein Kampf = 2 gewonnene Runden). Stärkere Gegner geben mehr, dazu Bonus für Paraden und einen makellosen 2:0-Sieg.
- Pro Stufe 3 Attributpunkte: Vis (schwere Schläge, Schildstoß), Corpus (Leben), Spiritus (Ausdauer), Celeritas (Tempo, Paradefenster), Acies (Kopftreffer, leichte Schläge), Gloria (Gunst des Publikums). Ab 40 Punkten wirkt jeder Punkt nur noch halb.
- Training: fünf KI-Gegner von Rekrut (Stufe 1) bis Primus Palus (Stufe 40).
- Mehrspieler: Der Gastgeber wählt „Offen“ (Stufe zählt voll) oder „Angeglichen“ (nur die Verteilung zählt).
- Gespeichert im Browser; „Als Datei sichern“ / „Aus Datei laden“ zum Umziehen auf ein anderes Handy.

**Publikum und Kaiser (Phase 3)**
- Rund 1.500 Zuschauer in den Rängen (je nach Grafikstufe), im Shader animiert: wippen, jubeln, Arme hoch, Welle.
- Gunst des Publikums: Paraden, Treffer, Finten und Ausweichen bringen Gunst, lange Pausen kosten sie. Die ✊-Taste heizt an – im richtigen Moment tobt die Menge, wer verliert, wird ausgebuht.
- Sehr hohe Gunst: Wein und Brot fliegen in die Arena (Leben und Ausdauer). Sehr niedrige Gunst: faules Obst.
- Kampfende: Zeitlupe, der Verlierer sinkt auf die Knie, das Volk stimmt ab, der Kaiser zeigt den Daumen. Missio = Gnade, Iugula = Todesstoß.
- Ton ohne Audiodateien (Web Audio): Menge, Jubel, Buhrufe, Metall, Schild, Treffer, Fanfare. Abschaltbar in den Einstellungen.

**Wetter (Phase 3)**
- Klar und heiß, Bewölkt, Regen, Gewitter, Nebel – zufällig oder fest in den Einstellungen; im Mehrspieler bestimmt der Gastgeber.
- Wolkenschicht, weiche Schatten bei Bewölkung, Regenstreifen und Spritzer, nasser dunkler Sand, Pfützen, glänzende Rüstung, Blitze mit Donner, Bodennebel.
- Wirkung: Hitze bremst die Ausdauer-Erholung (−10 %), nasser Sand macht Ausweichen teurer (+25 %), Nebel verkürzt das Aufschalten.

## Steuerung

| Aktion | Schema A: Gesten | Schema B: Tasten |
| --- | --- | --- |
| Laufen | Linker Daumen ziehen | Linker Daumen ziehen |
| Deckung wählen | Rechter Daumen nach oben/links/rechts schieben | ▲ ◀ ▶ |
| Leichter Angriff | Rechts tippen | „Schlag“ tippen |
| Schwerer Angriff | Rechts halten | „Schlag“ halten |
| Parade | Schnell in die Angriffsrichtung wischen | „Parade“ im richtigen Moment |
| Finte | Während des schweren Angriffs wischen | Während des schweren Angriffs „Parade“ |
| Deckung brechen | Mit zwei Fingern tippen | „Faust“ |
| Ausweichen | Nach unten wischen (Richtung mit dem Stick) | „Rolle“ |
| Aufschalten an/aus | ◎ oben rechts | ◎ oben rechts |

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
