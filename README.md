# Sanguis et Gloria

Brutales Gladiatoren-PvP für den Handy-Browser, gespielt im Querformat.
Gebaut mit [Babylon.js 9](https://www.babylonjs.com), läuft komplett über GitHub Pages.

**Spielen:** https://mhfsim.github.io/Gladiator-Game/

## Stand: Phase 1 – Richtungskampf

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
