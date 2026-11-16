# Sanguis et Gloria

Brutales Gladiatoren-PvP für den Handy-Browser, gespielt im Querformat.
Gebaut mit [Babylon.js 9](https://www.babylonjs.com), läuft komplett über GitHub Pages.

**Spielen:** https://mhfsim.github.io/Gladiator-Game/

## Stand: Phase 6 – Grafik und Spielgefühl überarbeitet

**Licht und Atmosphäre (Phase 6)**
- Kino-Farbstimmung: warme Lichter, kühle Schatten, abends golden; in Zeitlupe und beim Urteil bleichen die Farben aus.
- Lichtstrahlen der Sonne durch Bögen, Masten und Sonnensegel (Ultra und Hoch).
- Tiefenschärfe: der Kampf scharf, die Ränge weich, in Kinomomenten stärker (Ultra). Leichte Objektiv-Farbsäume, die bei harten Treffern anziehen.
- Schwebender Staub um die Kamera, der im Gegenlicht leuchtet; mehr Luftperspektive in der Tiefe.
- Nachts Mondlicht und ein Ring aus Fackeln auf der Podiumsmauer, Glut steigt aus den Feuerbecken.
- Standard-Tageszeit ist jetzt die goldene Abendstunde (18:12).

**Arena, Effekte, Spielgefühl (Phase 6)**
- Kontaktschatten unter Kämpfern und Tieren, Fußspuren im Sand, aufwirbelnder Sand bei Rolle, Sturz, Schildramme und galoppierenden Tieren.
- Funken als glühende Streifen mit kurzem Lichtblitz; getroffene Körper blitzen rot auf, Paraden golden.
- Wuchtschläge kündigen sich mit einem Aufblitzen an der Waffenspitze an.
- Wandmalereien gedämpft und von der Sonne ausgeblichen, natürlichere Farben im Publikum, Gänge im Kolosseum nicht mehr pechschwarz.
- Kamera: weicher und bildratenunabhängig, zieht bei Abstand zurück, weicht Säulen und Feuerbecken aus, leichtes Atmen wie aus der Hand.
- KI mit Kampfstil je Klasse und eigenem Temperament (Thraex stürmt, Murmillo mauert, Retiarius tänzelt …).
- Ultra hält etwa 40 Bilder pro Sekunde, bevor die Auflösung sinkt (Schönheit zuerst).

## Phase 5 – Spielmodi und Arenaleben

**Spielmodi (Phase 5)**
- Duell, 2 gegen 2, 3 gegen 3, Jeder gegen jeden mit 4 oder 8 Kämpfern – im Training und im Mehrspieler.
- Training: KI-Gefährten an deiner Seite, KI-Gegner in fünf Stufen. Im Mehrspieler füllt die KI freie Plätze.
- Teamfarben auf Schild und Federbusch, Namen und Leben über den anderen Kämpfern, ◎ wechselt das Ziel, nach dem eigenen Tod schaut die Kamera zu.
- Venatio: gemeinsam gegen fünf Wellen aus Wölfen und Stieren, allein mit KI-Gefährte oder mit bis zu vier Spielern.
- Turnier: acht Gladiatoren, Viertelfinale, Halbfinale, Finale. Der Turniersieg bringt dreifache Denare und seltene Beute oder besser.
- Hausrangliste mit Glicko-2: Duelle gegen Menschen verändern die Wertung, Rangtitel von Novicius bis Primus Palus, eigene Liste aller Gegner. Jedes Vierteljahr beginnt eine neue Saison (Wertung rückt halb zur Mitte).

**Arenaleben (Phase 5, abschaltbar)**
- Spießfallen: eiserne Gitterplatten im Sand. Wer drauftritt, löst sie aus – nach kurzem Glühen schießen Spieße heraus und bleiben blutig. Gegner auf eine Platte locken lohnt sich.
- Der Spielleiter ruft Ereignisse aus: Wölfe werden freigelassen, ein Stier stürmt herein, alle Fallen erwachen.
- Wölfe pirschen im Bogen heran und springen zu; Block und Parade wirken auch gegen sie. Der Stier scharrt, nimmt Anlauf und rennt alles um – ausweichen oder er bricht die Deckung. Prallt er gegen die Mauer, ist er benommen und verwundbar.
- Die KI weicht Fallen und dem Stier aus und wehrt sich gegen Tiere. Tiermodelle: Quaternius „Ultimate Animated Animals“ (CC0).


**Arena und Grafik (Phase 0)**
- Ludus von Capua, komplett im Code erzeugt: bemalte Podiumsmauer, zwei Tore mit Fallgitter, Sitzstufen,
  Säulengang mit Ziegeldach, Fahnen, Trainingspfähle, Waffengestell, Feuerbecken, Zypressen, rauchender Vesuv.
- Physikalischer Himmel, Sonne mit weichen Schatten, Dunst, Staub, Tageszeit 6–20:30 Uhr im Menü.
- Murmillo mit Helm, Federbusch, Gittervisier, bemaltem Scutum, Gladius, Manica, Beinschiene, Gürtel.

**Kampf (überarbeitet in Phase 4: einfacher, mehr Action)**
- Schlag tippen: Kombo aus drei Schlägen, der dritte trifft härter. Schlag halten: Wuchtschlag, bricht jeden Block und lässt sich im Ausholen nicht von leichten Treffern stoppen.
- Block halten: fängt Schläge von vorn ab, Richtung automatisch. Block im richtigen Moment drücken (goldener Ring „JETZT“) = Parade: der Gegner taumelt, dein nächster Schlag kommt schneller und härter.
- Schildstoß bricht jeden Block. Ausweichrolle mit Unverwundbarkeit.
- Wucht: Trefferpause, Kamera-Stoß, Waffenspur, roter Bildrand bei eigenem Treffer, Vibration (Android), Rückstoß, doppeltes Blut bei harten Treffern.
- Trefferzonen Kopf, Rumpf, Waffenarm, Bein mit Rüstung je Klasse und Ausrüstung.
- KI in fünf Stufen: blockt, pariert, weicht aus, schlägt Kombos, bricht Dauerblocker mit dem Schildstoß, nutzt die Sonderfähigkeit ihrer Klasse.
- Alle Kampfwerte in `src/data/combat.json`, Klassen in `src/data/classes.ts`.

**Klassen, Ausrüstung, Schmied (Phase 4)**
- Sechs Klassen mit eigener Ausrüstung im Code: Murmillo (Schildramme), Secutor (Verfolgung), Thraex (Hakenschlag um den Schild), Hoplomachus (Speerwurf), Retiarius (Netzwurf, kein Helm und Schild), Provocator (Herausforderung).
- Klasse im Heldenmenü frei wählbar. Jede Klasse hat eigene Reichweite, Tempo, Blockkosten und Rüstung.
- Ausrüstung in fünf Plätzen (Waffe, Schild, Helm, Armschutz, Beinschutz) und fünf Seltenheiten bis Legendär; die Metallfarbe zeigt die Seltenheit.
- Nach jedem Sieg: Denare und ein Beutestück. Niederlagen bringen nichts.
- Schmied: aufwerten bis +10 (ab +6 mit Risiko), Unnötiges zerlegen.

**Mehrspieler (Phase 2)**
- Hauptmenü: Training gegen die KI, Arena eröffnen, Arena beitreten.
- Gastgeber bekommt einen 6-stelligen Code, QR-Code und einen Link zum Teilen.
- Verbindung direkt zwischen den Handys (WebRTC über Trystero), kein eigener Server.
- Das Handy des Gastgebers entscheidet über alle Treffer, Paraden und Blocks; der Gast sieht dasselbe mit kurzer Verzögerung.
- Lobby für bis zu acht Spieler: Der Gastgeber wählt Modus, Arena und Werte und startet, wenn alle da sind.
- Verlässt ein Gast die Arena, übernimmt die KI seinen Kämpfer.
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
- Blut bleibt im Sand: unregelmäßige, nass glänzende Spritzer, unter Gefallenen wächst eine Lache. Beim Todesstoß geht die Kamera tief und nah heran.
- Ton ohne Audiodateien (Web Audio): Menge, Jubel, Buhrufe, Metall, Schild, Treffer, Fanfare. Abschaltbar in den Einstellungen.

**Wetter (Phase 3)**
- Klar und heiß, Bewölkt, Regen, Gewitter, Nebel – zufällig oder fest in den Einstellungen; im Mehrspieler bestimmt der Gastgeber.
- Wolkenschicht, weiche Schatten bei Bewölkung, Regenstreifen und Spritzer, nasser dunkler Sand, Pfützen, glänzende Rüstung, Blitze mit Donner, Bodennebel.
- Wirkung: Hitze bremst die Ausdauer-Erholung (−10 %), nasser Sand macht Ausweichen teurer (+25 %), Nebel verkürzt das Aufschalten.

**Kolosseum (Phase 3)**
- Zweite Arena: elliptisch, Marmor-Podium mit Bronzegeländer, drei Ränge mit Senatorenplätzen, Bogengänge, Säulengang, Attika mit Masten und Sonnensegel (Velarium), Falltüren zum Hypogäum, Kaiserloge.
- Bis zu 9.000 Zuschauer (je nach Grafikstufe).
- Auswahl im Training und beim Eröffnen einer Arena; der Gast wechselt automatisch in die Arena des Gastgebers. Der Wechsel geht ohne Neuladen.

**Brutalität (Regler in den Einstellungen: Voll / Reduziert / Aus)**
- Treffer: Blutfontäne, gestreckte Spritzer, Blutnebel, viele Flecken im Sand in Schlagrichtung, glänzende Wunden am Körper, die Waffe wird mit jedem Treffer blutiger.
- Wenig Leben: der Kämpfer blutet, Tropfen und Flecken unter ihm.
- Tödliche Treffer (besonders Wuchtschläge und Kombo-Abschlüsse): Kopf, Arme oder Unterschenkel werden abgetrennt und fliegen mit Physik durch die Arena, samt Helm, Waffe oder Schild. Aus dem Stumpf pulsiert eine Fontäne im Herzschlag, darunter wächst eine Lache.
- „Iugula!“: Der Todesstoß trennt immer den Kopf ab.
- Blut auf der Kamera, wenn es nah spritzt.

## Steuerung

| Aktion | Schema A: Gesten | Schema B: Tasten |
| --- | --- | --- |
| Laufen | Linker Daumen ziehen | Linker Daumen ziehen |
| Schlag / Kombo | Rechts tippen | „Schlag“ tippen |
| Wuchtschlag | Rechts halten | „Schlag“ halten |
| Block / Parade | „Block“ halten / im richtigen Moment drücken | „Block“ halten / im richtigen Moment drücken |
| Schildstoß | Mit zwei Fingern tippen | „Stoß“ |
| Ausweichen | Rechts wischen (in Wischrichtung) | „Rolle“ (Richtung mit dem Stick) |
| Sonderfähigkeit | Klassentaste neben „Block“ | Klassentaste |
| Publikum anheizen | ✊ oben links | ✊ oben links |
| Aufschalten an/aus, Ziel wechseln | ◎ oben rechts | ◎ oben rechts |

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
node tools/build-animals.mjs <Ordner von „Ultimate Animated Animals“>   # Wolf und Stier
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

Code: MIT (siehe `LICENSE`). Figuren, Tiere und Animationen: CC0 von Quaternius (siehe `CREDITS.md`).
