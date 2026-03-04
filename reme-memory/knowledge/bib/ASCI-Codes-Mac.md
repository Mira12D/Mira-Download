# Telekolleg Mac: Die ultimative Bibliothek aller sichtbaren Zeichen – Von ASCII bis Unicode

## Einführung: Was bedeutet "alles, was gerendert wird"?

Stell dir vor, du sitzt vor deinem Mac und siehst einen Bildschirm voller Informationen. Da ist der Text in deinem Browser, die Buttons in deiner E-Mail-App, die Symbole in der Menüleiste, die URL in der Adressleiste, die Buchstaben in deinem Dokument – **alles, was du siehst, wird "gerendert"**. Das bedeutet: Der Computer nimmt unsichtbare Codes und verwandelt sie in sichtbare Zeichen auf dem Bildschirm.

In dieser ultimativen Bibliothek geht es um **JEDES EINZELNE dieser Zeichen**. Vom einfachen Buchstaben "A" bis zum speziellen Apple-Logo, vom unsichtbaren Steuerzeichen bis zum Emoji. Ich habe alles für dich in einer riesigen, systematischen Liste zusammengestellt.

**Die große Philosophie:** Der Mac verwendet zwei verschiedene Systeme nebeneinander:
1. **MacRoman (historisch)** – Der klassische 8-Bit-Zeichensatz der älteren Macs 
2. **Unicode (modern)** – Das universelle System für über 150.000 Zeichen aus aller Welt 

Beide sind wichtig! Viele alte Dokumente verwenden noch MacRoman, während moderne Programme auf Unicode setzen. Ich zeige dir beide Welten.


---

## Block 1000-1099: Steuerzeichen (Die unsichtbaren Kommandos)

Diese Zeichen sind auf **ALLEN Systemen identisch** – Windows, Mac, Linux. Sie haben kein sichtbares Bild, sondern steuern den Computer. Wenn du sie in einem Dokument siehst, stimmt meist etwas mit der Zeichenkodierung nicht.

| Code (dez) | Code (hex) | Zeichen | Name | Funktion |
|------------|------------|---------|------|----------|
| **1000** | 0x00 | NUL | Nullzeichen | Platzhalter, nichts |
| **1001** | 0x01 | SOH | Start of Heading | Historisch: Kopfzeilenbeginn |
| **1002** | 0x02 | STX | Start of Text | Historisch: Textbeginn |
| **1003** | 0x03 | ETX | End of Text | Historisch: Textende |
| **1004** | 0x04 | EOT | End of Transmission | Übertragungsende |
| **1005** | 0x05 | ENQ | Enquiry | "Bist du da?" |
| **1006** | 0x06 | ACK | Acknowledgment | "Ja, bin da" |
| **1007** | 0x07 | BEL | Bell | Warnton/Piepser |
| **1008** | 0x08 | BS | Backspace | Rücktaste |
| **1009** | 0x09 | HT | Horizontal Tab | Tabulator-Taste |
| **1010** | 0x0A | LF | Line Feed | Zeilenvorschub (Teil von Enter) |
| **1011** | 0x0B | VT | Vertical Tab | Vertikaler Tabulator |
| **1012** | 0x0C | FF | Form Feed | Seitenvorschub (Drucker) |
| **1013** | 0x0D | CR | Carriage Return | Wagenrücklauf (Teil von Enter) |
| **1014** | 0x0E | SO | Shift Out | Alternativer Zeichensatz |
| **1015** | 0x0F | SI | Shift In | Zurück zum Standard |
| **1016** | 0x10 | DLE | Data Link Escape | Datenübertragung |
| **1017** | 0x11 | DC1 | Device Control 1 | Gerätesteuerung |
| **1018** | 0x12 | DC2 | Device Control 2 | Gerätesteuerung |
| **1019** | 0x13 | DC3 | Device Control 3 | Oft XOFF (Stop) |
| **1020** | 0x14 | DC4 | Device Control 4 | Oft XON (Start) |
| **1021** | 0x15 | NAK | Negative Acknowledgment | Fehler, nochmal senden |
| **1022** | 0x16 | SYN | Synchronous Idle | Synchronisation |
| **1023** | 0x17 | ETB | End of Transmission Block | Ende Datenblock |
| **1024** | 0x18 | CAN | Cancel | Abbruch |
| **1025** | 0x19 | EM | End of Medium | Ende Datenträger |
| **1026** | 0x1A | SUB | Substitute | Ersatz für fehlerhaftes Zeichen |
| **1027** | 0x1B | ESC | Escape | ESC-Taste (Steuersequenz) |
| **1028** | 0x1C | FS | File Separator | Datei-Trenner |
| **1029** | 0x1D | GS | Group Separator | Gruppen-Trenner |
| **1030** | 0x1E | RS | Record Separator | Datensatz-Trenner |
| **1031** | 0x1F | US | Unit Separator | Einheiten-Trenner |
| **1032** | 0x7F | DEL | Delete | Löschen |


---

## Block 1100-1199: Grundlegende Satzzeichen (Standard-Tastatur)

Diese Zeichen findest du auf jeder Tastatur. Sie sind auf Mac und Windows identisch, aber die Tastenkombinationen können leicht abweichen .

| Code (dez) | Code (hex) | Zeichen | Name | Mac-Tastenkombi |
|------------|------------|---------|------|------------------|
| **1100** | 0x20 | (Leerzeichen) | Leerzeichen | Leertaste |
| **1101** | 0x21 | ! | Ausrufezeichen | Shift + 1 |
| **1102** | 0x22 | " | Anführungszeichen (doppelt) | Shift + 2 |
| **1103** | 0x23 | # | Raute (Doppelkreuz) | Shift + 3 |
| **1104** | 0x24 | $ | Dollar | Shift + 4 |
| **1105** | 0x25 | % | Prozent | Shift + 5 |
| **1106** | 0x26 | & | Und (Ampersand) | Shift + 6 |
| **1107** | 0x27 | ' | Apostroph | Shift + # (oder ´-Taste) |
| **1108** | 0x28 | ( | Klammer auf (rund) | Shift + 8 |
| **1109** | 0x29 | ) | Klammer zu (rund) | Shift + 9 |
| **1110** | 0x2A | * | Sternchen, Mal | Shift + + (oder auf Ziffernblock) |
| **1111** | 0x2B | + | Plus | Shift + + (Taste rechts neben 0) |
| **1112** | 0x2C | , | Komma | , (rechts neben M) |
| **1113** | 0x2D | - | Bindestrich, Minus | - (rechts neben .) |
| **1114** | 0x2E | . | Punkt | . (rechts neben M) |
| **1115** | 0x2F | / | Schrägstrich (Slash) | / |
| **1116** | 0x3A | : | Doppelpunkt | Shift + . |
| **1117** | 0x3B | ; | Semikolon (Strichpunkt) | Shift + , |
| **1118** | 0x3C | < | Kleiner-als | Option + Shift + , (Komma) |
| **1119** | 0x3D | = | Gleich | Shift + 0 |
| **1120** | 0x3E | > | Größer-als | Option + Shift + . (Punkt) |
| **1121** | 0x3F | ? | Fragezeichen | Shift + ß |
| **1122** | 0x40 | @ | At-Zeichen | Shift + L (oder Option + L je nach Layout) |
| **1123** | 0x5B | [ | Eckige Klammer auf | Option + 5 |
| **1124** | 0x5C | \ | Backslash | Option + Shift + 7 |
| **1125** | 0x5D | ] | Eckige Klammer zu | Option + 6 |
| **1126** | 0x5E | ^ | Zirkumflex (Dach) | Shift + ´ |
| **1127** | 0x5F | _ | Unterstrich | Shift + - |
| **1128** | 0x60 | ` | Backtick (Grave) | ´-Taste (neben ß) |
| **1129** | 0x7B | { | Geschweifte Klammer auf | Option + 8 |
| **1130** | 0x7C | \| | Senkrechter Strich | Option + 7 |
| **1131** | 0x7D | } | Geschweifte Klammer zu | Option + 9 |
| **1132** | 0x7E | ~ | Tilde | Option + N (dann Leertaste) |


---

## Block 1200-1299: Buchstaben A-Z, a-z (Identisch auf ALLEN Systemen)

Diese Codes sind **weltweit standardisiert**. Egal ob Windows, Mac, Linux oder Handy – A ist immer 65 (0x41).

### Große Buchstaben (1200-1225)

| Code | Hex | Zeichen | Name |
|------|-----|---------|------|
| **1200** | 0x41 | A | Großes A |
| **1201** | 0x42 | B | Großes B |
| **1202** | 0x43 | C | Großes C |
| **1203** | 0x44 | D | Großes D |
| **1204** | 0x45 | E | Großes E |
| **1205** | 0x46 | F | Großes F |
| **1206** | 0x47 | G | Großes G |
| **1207** | 0x48 | H | Großes H |
| **1208** | 0x49 | I | Großes I |
| **1209** | 0x4A | J | Großes J |
| **1210** | 0x4B | K | Großes K |
| **1211** | 0x4C | L | Großes L |
| **1212** | 0x4D | M | Großes M |
| **1213** | 0x4E | N | Großes N |
| **1214** | 0x4F | O | Großes O |
| **1215** | 0x50 | P | Großes P |
| **1216** | 0x51 | Q | Großes Q |
| **1217** | 0x52 | R | Großes R |
| **1218** | 0x53 | S | Großes S |
| **1219** | 0x54 | T | Großes T |
| **1220** | 0x55 | U | Großes U |
| **1221** | 0x56 | V | Großes V |
| **1222** | 0x57 | W | Großes W |
| **1223** | 0x58 | X | Großes X |
| **1224** | 0x59 | Y | Großes Y |
| **1225** | 0x5A | Z | Großes Z |

### Kleine Buchstaben (1250-1275)

| Code | Hex | Zeichen | Name |
|------|-----|---------|------|
| **1250** | 0x61 | a | Kleines a |
| **1251** | 0x62 | b | Kleines b |
| **1252** | 0x63 | c | Kleines c |
| **1253** | 0x64 | d | Kleines d |
| **1254** | 0x65 | e | Kleines e |
| **1255** | 0x66 | f | Kleines f |
| **1256** | 0x67 | g | Kleines g |
| **1257** | 0x68 | h | Kleines h |
| **1258** | 0x69 | i | Kleines i |
| **1259** | 0x6A | j | Kleines j |
| **1260** | 0x6B | k | Kleines k |
| **1261** | 0x6C | l | Kleines l |
| **1262** | 0x6D | m | Kleines m |
| **1263** | 0x6E | n | Kleines n |
| **1264** | 0x6F | o | Kleines o |
| **1265** | 0x70 | p | Kleines p |
| **1266** | 0x71 | q | Kleines q |
| **1267** | 0x72 | r | Kleines r |
| **1268** | 0x73 | s | Kleines s |
| **1269** | 0x74 | t | Kleines t |
| **1270** | 0x75 | u | Kleines u |
| **1271** | 0x76 | v | Kleines v |
| **1272** | 0x77 | w | Kleines w |
| **1273** | 0x78 | x | Kleines x |
| **1274** | 0x79 | y | Kleines y |
| **1275** | 0x7A | z | Kleines z |


---

## Block 1300-1399: Ziffern (Identisch auf ALLEN Systemen)

| Code | Hex | Zeichen | Name |
|------|-----|---------|------|
| **1300** | 0x30 | 0 | Null |
| **1301** | 0x31 | 1 | Eins |
| **1302** | 0x32 | 2 | Zwei |
| **1303** | 0x33 | 3 | Drei |
| **1304** | 0x34 | 4 | Vier |
| **1305** | 0x35 | 5 | Fünf |
| **1306** | 0x36 | 6 | Sechs |
| **1307** | 0x37 | 7 | Sieben |
| **1308** | 0x38 | 8 | Acht |
| **1309** | 0x39 | 9 | Neun |


---

## Block 1400-1499: Deutsche Umlaute und Sonderbuchstaben

Hier gibt es **zwei verschiedene Systeme** nebeneinander :

1. **MacRoman (historisch):** Feste Codes für Umlaute (z.B. 0x8A = ä)
2. **Modern:** Umlaute werden über **Option + U** (Umlaut-Basis) + Buchstabe eingegeben

### Umlaute im MacRoman-System (historische Codes)

| Code (dez) | Code (hex) | Zeichen | Name |
|------------|------------|---------|------|
| **1400** | 0x80 | Ä | Großes A mit Umlaut |
| **1401** | 0x81 | Å | Großes A mit Ring |
| **1402** | 0x82 | Ç | Großes C mit Cedille |
| **1403** | 0x83 | É | Großes E mit Akut |
| **1404** | 0x84 | Ñ | Großes N mit Tilde |
| **1405** | 0x85 | Ö | Großes O mit Umlaut |
| **1406** | 0x86 | Ü | Großes U mit Umlaut |
| **1407** | 0x87 | á | Kleines a mit Akut |
| **1408** | 0x88 | à | Kleines a mit Grave |
| **1409** | 0x89 | â | Kleines a mit Zirkumflex |
| **1410** | 0x8A | ä | Kleines a mit Umlaut |
| **1411** | 0x8B | ã | Kleines a mit Tilde |
| **1412** | 0x8C | å | Kleines a mit Ring |
| **1413** | 0x8D | ç | Kleines c mit Cedille |
| **1414** | 0x8E | é | Kleines e mit Akut |
| **1415** | 0x8F | è | Kleines e mit Grave |
| **1416** | 0x90 | ê | Kleines e mit Zirkumflex |
| **1417** | 0x91 | ë | Kleines e mit Trema |
| **1418** | 0x92 | í | Kleines i mit Akut |
| **1419** | 0x93 | ì | Kleines i mit Grave |
| **1420** | 0x94 | î | Kleines i mit Zirkumflex |
| **1421** | 0x95 | ï | Kleines i mit Trema |
| **1422** | 0x96 | ñ | Kleines n mit Tilde |
| **1423** | 0x97 | ó | Kleines o mit Akut |
| **1424** | 0x98 | ò | Kleines o mit Grave |
| **1425** | 0x99 | ô | Kleines o mit Zirkumflex |
| **1426** | 0x9A | ö | Kleines o mit Umlaut |
| **1427** | 0x9B | õ | Kleines o mit Tilde |
| **1428** | 0x9C | ú | Kleines u mit Akut |
| **1429** | 0x9D | ù | Kleines u mit Grave |
| **1430** | 0x9E | û | Kleines u mit Zirkumflex |
| **1431** | 0x9F | ü | Kleines u mit Umlaut |
| **1432** | 0xA7 | ß | Eszett (scharfes S)  |

### Moderne Eingabe der Umlaute 

| Zeichen | Mac-Tastenkombination |
|---------|------------------------|
| ä | Option + U, dann A |
| ö | Option + U, dann O |
| ü | Option + U, dann U |
| Ä | Option + U, dann Shift + A |
| Ö | Option + U, dann Shift + O |
| Ü | Option + U, dann Shift + U |
| ß | Option + S |


---

## Block 1500-1599: Typografische Symbole und Währungen

Diese Zeichen findest du auf dem Mac oft direkt über die Option-Taste.

| Code | Hex | Zeichen | Name | Mac-Tastenkombi | Unicode |
|------|-----|---------|------|------------------|---------|
| **1500** | 0xA0 | † | Kreuz (Dagger) | ? | U+2020 |
| **1501** | 0xA1 | ° | Gradzeichen | Option + Shift + 8 | U+00B0 |
| **1502** | 0xA2 | ¢ | Cent | Option + 4 | U+00A2 |
| **1503** | 0xA3 | £ | Pfund | Option + 3 | U+00A3 |
| **1504** | 0xA4 | § | Paragraph | Shift + 3 | U+00A7 |
| **1505** | 0xA5 | • | Aufzählungspunkt | Option + 8 (oder Shift + Option + 9) | U+2022 |
| **1506** | 0xA6 | ¶ | Pilcrow (Absatzzeichen) | Option + 7 | U+00B6 |
| **1507** | 0xA8 | ® | Registered | Option + R | U+00AE |
| **1508** | 0xA9 | © | Copyright | Option + G | U+00A9 |
| **1509** | 0xAA | ™ | Trademark | Option + 2 | U+2122 |
| **1510** | 0xAB | ´ | Akut | ´-Taste (neben ß) | U+00B4 |
| **1511** | 0xAC | ¨ | Trema (Umlaut) | Option + U (als Tottaste) | U+00A8 |
| **1512** | 0xAD | ≠ | Ungleich | Option + = | U+2260 |
| **1513** | 0xAE | Æ | Große AE-Ligatur | Option + Shift + ' | U+00C6 |
| **1514** | 0xAF | Ø | Großes O mit Schrägstrich | Option + Shift + O | U+00D8 |
| **1515** | 0xB0 | ∞ | Unendlich | Option + 5 | U+221E |
| **1516** | 0xB1 | ± | Plus-Minus | Option + Shift + = | U+00B1 |
| **1517** | 0xB2 | ≤ | Kleiner-gleich | Option + , (Komma) | U+2264 |
| **1518** | 0xB3 | ≥ | Größer-gleich | Option + . (Punkt) | U+2265 |
| **1519** | 0xB4 | ¥ | Yen | Option + Y | U+00A5 |
| **1520** | 0xB5 | µ | Mikro | Option + M | U+00B5 |
| **1521** | 0xB6 | ∂ | Partielle Ableitung | Option + D | U+2202 |
| **1522** | 0xB7 | ∑ | Summenzeichen | Option + W | U+2211 |
| **1523** | 0xB8 | ∏ | Produktzeichen | Über Zeichenübersicht | U+220F |
| **1524** | 0xB9 | π | Pi | Option + P | U+03C0 |
| **1525** | 0xBA | ∫ | Integral | Option + B | U+222B |
| **1526** | 0xBB | ª | Weibliches Ordinalzeichen | Option + 9 (oder Shift + Option + 9) | U+00AA |
| **1527** | 0xBC | º | Männliches Ordinalzeichen | Option + 0 | U+00BA |
| **1528** | 0xBD | Ω | Omega (Ohm) | Option + Z | U+03A9 |
| **1529** | 0xBE | æ | Kleine AE-Ligatur | Option + ' | U+00E6 |
| **1530** | 0xBF | ø | Kleines o mit Schrägstrich | Option + O | U+00F8 |
| **1531** | 0xDB | € | Euro | Option + E (dann Leertaste) oder Option + Shift + 2 | U+20AC |


---

## Block 1600-1699: Spanische und französische Zeichen

| Code | Hex | Zeichen | Name | Mac-Tastenkombi |
|------|-----|---------|------|------------------|
| **1600** | 0xC0 | ¿ | Umgekehrtes Fragezeichen | Option + Shift + ? |
| **1601** | 0xC1 | ¡ | Umgekehrtes Ausrufezeichen | Option + 1 |
| **1602** | 0xC2 | ¬ | Nicht-Zeichen | Option + L |
| **1603** | 0xC3 | √ | Quadratwurzel | Option + V |
| **1604** | 0xC4 | ƒ | Florin (niederländischer Gulden) | Option + F |
| **1605** | 0xC5 | ≈ | Ungefähr | Option + X |
| **1606** | 0xC6 | ∆ | Delta (Dreieck) | Option + J |
| **1607** | 0xC7 | « | Guillemet links (Anführungszeichen) | Option + \ |
| **1608** | 0xC8 | » | Guillemet rechts | Option + Shift + \ |
| **1609** | 0xC9 | … | Auslassungspunkte (Ellipse) | Option + ; |
| **1610** | 0xCA | NBSP | Geschütztes Leerzeichen | Option + Leertaste |
| **1611** | 0xCB | À | Großes A mit Grave | Option + `, dann Shift + A |
| **1612** | 0xCC | Ã | Großes A mit Tilde | Option + N, dann Shift + A |
| **1613** | 0xCD | Õ | Großes O mit Tilde | Option + N, dann Shift + O |
| **1614** | 0xCE | Œ | Große OE-Ligatur | Option + Shift + Q |
| **1615** | 0xCF | œ | Kleine OE-Ligatur | Option + Q |


---

## Block 1700-1799: Striche, Gedankenstriche und Anführungszeichen

Typografisch korrekte Striche – wichtig für professionelle Dokumente.

| Code | Hex | Zeichen | Name | Mac-Tastenkombi | Unicode |
|------|-----|---------|------|------------------|---------|
| **1700** | 0xD0 | – | Gedankenstrich (Halbgeviertstrich, En-dash) | Option + - | U+2013 |
| **1701** | 0xD1 | — | Gedankenstrich (Geviertstrich, Em-dash) | Option + Shift + - | U+2014 |
| **1702** | 0xD2 | “ | Doppeltes Anführungszeichen links (auf) | Option + [ | U+201C |
| **1703** | 0xD3 | ” | Doppeltes Anführungszeichen rechts (zu) | Option + Shift + [ | U+201D |
| **1704** | 0xD4 | ‘ | Einfaches Anführungszeichen links (auf) | Option + ] | U+2018 |
| **1705** | 0xD5 | ’ | Einfaches Anführungszeichen rechts (zu) | Option + Shift + ] | U+2019 |
| **1706** | 0xD6 | ÷ | Geteiltzeichen | Option + / | U+00F7 |
| **1707** | 0xD7 | ◊ | Raute (Lozenge) | Option + Shift + V | U+25CA |
| **1708** | 0xD8 | ÿ | Kleines y mit Trema | Option + U, dann Y | U+00FF |
| **1709** | 0xD9 | Ÿ | Großes Y mit Trema | Option + U, dann Shift + Y | U+0178 |
| **1710** | 0xDA | ⁄ | Bruchstrich | Option + Shift + 1 | U+2044 |
| **1711** | 0xDC | ‹ | Einfaches Guillemet links | Option + Shift + 3 | U+2039 |
| **1712** | 0xDD | › | Einfaches Guillemet rechts | Option + Shift + 4 | U+203A |
| **1713** | 0xDE | ﬁ | fi-Ligatur | Über Zeichenübersicht | U+FB01 |
| **1714** | 0xDF | ﬂ | fl-Ligatur | Über Zeichenübersicht | U+FB02 |


---

## Block 1800-1899: Weitere typografische Symbole

| Code | Hex | Zeichen | Name | Mac-Tastenkombi |
|------|-----|---------|------|------------------|
| **1800** | 0xE0 | ‡ | Doppelkreuz (Double Dagger) | Option + Shift + 7 |
| **1801** | 0xE1 | · | Mittelpunkt | Option + Shift + 9 |
| **1802** | 0xE2 | ‚ | Einfaches Anführungszeichen unten | Option + Shift + W |
| **1803** | 0xE3 | „ | Doppeltes Anführungszeichen unten | Option + Shift + Q |
| **1804** | 0xE4 | ‰ | Promille | Option + Shift + R |
| **1805** | 0xE5 | Â | Großes A mit Zirkumflex | Option + I, dann Shift + A |
| **1806** | 0xE6 | Ê | Großes E mit Zirkumflex | Option + I, dann Shift + E |
| **1807** | 0xE7 | Á | Großes A mit Akut | Option + E, dann Shift + A |
| **1808** | 0xE8 | Ë | Großes E mit Trema | Option + U, dann Shift + E |
| **1809** | 0xE9 | È | Großes E mit Grave | Option + `, dann Shift + E |
| **1810** | 0xEA | Í | Großes I mit Akut | Option + E, dann Shift + I |
| **1811** | 0xEB | Î | Großes I mit Zirkumflex | Option + I, dann Shift + I |
| **1812** | 0xEC | Ï | Großes I mit Trema | Option + U, dann Shift + I |
| **1813** | 0xED | Ì | Großes I mit Grave | Option + `, dann Shift + I |
| **1814** | 0xEE | Ó | Großes O mit Akut | Option + E, dann Shift + O |
| **1815** | 0xEF | Ô | Großes O mit Zirkumflex | Option + I, dann Shift + O |
| **1816** | 0xF0 | **** | **APPLE-LOGO** | **Option + Shift + K**  |
| **1817** | 0xF1 | Ò | Großes O mit Grave | Option + `, dann Shift + O |
| **1818** | 0xF2 | Ú | Großes U mit Akut | Option + E, dann Shift + U |
| **1819** | 0xF3 | Û | Großes U mit Zirkumflex | Option + I, dann Shift + U |
| **1820** | 0xF4 | Ù | Großes U mit Grave | Option + `, dann Shift + U |
| **1821** | 0xF5 | ı | Kleines i ohne Punkt | Option + Shift + B |
| **1822** | 0xF6 | ˆ | Zirkumflex (Akzent) | Option + I (als Tottaste) |
| **1823** | 0xF7 | ˜ | Tilde (Akzent) | Option + N (als Tottaste) |
| **1824** | 0xF8 | ¯ | Makron (Überstrich) | Option + A (oder über Zeichenübersicht) |
| **1825** | 0xF9 | ˘ | Breve (Akzent) | Über Zeichenübersicht |
| **1826** | 0xFA | ˙ | Punkt (Akzent) | Über Zeichenübersicht |
| **1827** | 0xFB | ˚ | Ring (Akzent) | Option + K |
| **1828** | 0xFC | ¸ | Cedille (Akzent) | Option + C (als Tottaste für Cedille) |
| **1829** | 0xFD | ˝ | Doppelakut | Über Zeichenübersicht |
| **1830** | 0xFE | ˛ | Ogonek (Akzent) | Über Zeichenübersicht |
| **1831** | 0xFF | ˇ | Hacek (Caron) | Über Zeichenübersicht |


---

## Block 1900-1999: UI-Symbole und Sondertasten (Das Mac-Interface)

Diese Symbole siehst du in Menüs, in der Menüleiste und in Tastaturkürzeln. Sie sind **einzigartig für den Mac** .

| Code | Unicode | Zeichen | Name | Bedeutung |
|------|---------|---------|------|-----------|
| **1900** | U+2318 | ⌘ | Command-Symbol (Kleeblatt) | **Die wichtigste Taste auf dem Mac.** Entspricht Strg unter Windows. |
| **1901** | U+2325 | ⌥ | Option-Symbol | Option/Alt-Taste – für Sonderzeichen und Alternativfunktionen |
| **1902** | U+2303 | ⌃ | Control-Symbol | Steuerungstaste – oft in Terminal-Apps |
| **1903** | U+21E7 | ⇧ | Shift-Symbol | Umschalttaste (Großschreibung) |
| **1904** | U+21EA | ⇪ | Caps Lock-Symbol | Feststelltaste |
| **1905** | U+232B | ⌫ | Delete (Backspace) | Löscht Zeichen vor dem Cursor |
| **1906** | U+2326 | ⌦ | Forward Delete | Löscht Zeichen nach dem Cursor (Fn + ⌫) |
| **1907** | U+21A5 | ↩ | Return (Enter) | Eingabetaste |
| **1908** | U+21B5 | ↵ | Return (alternativ) | Eingabetaste |
| **1909** | U+231C | ⌤ | Enter (Ziffernblock) | Enter auf dem separaten Nummernblock |
| **1910** | U+238B | ⎋ | Escape (Esc) | Escape-Taste |
| **1911** | U+21E5 | ⇥ | Tab (vorwärts) | Tabulator-Taste |
| **1912** | U+21E4 | ⇤ | Shift-Tab (rückwärts) | Umschalt + Tab – zum vorherigen Feld |
| **1913** | U+21DE | ⇞ | Page Up | Bild hoch (Fn + Pfeil hoch) |
| **1914** | U+21DF | ⇟ | Page Down | Bild runter (Fn + Pfeil runter) |
| **1915** | U+2196 | ↖ | Home | Zum Zeilen-/Seitenanfang (Fn + Pfeil links) |
| **1916** | U+2198 | ↘ | End | Zum Zeilen-/Seitenende (Fn + Pfeil rechts) |
| **1917** | U+2327 | ⌧ | Clear | Löscht aktuellen Eintrag (auf Ziffernblock) |
| **1918** | U+2422 | ␢ | Space (Blank) | Leerzeichen-Symbol |
| **1919** | U+2423 | ␣ | Space (alternativ) | Leerzeichen-Symbol |
| **1920** | U+23CF | ⏏ | Eject | Auswurftaste (bei älteren Macs mit CD-Laufwerk) |
| **1921** | U+F8FF |  | **Apple-Logo** | Das klassische Apple-Symbol. **Option + Shift + K**  |
| **1922** | U+21E3 | ⇣ | Pfeil runter (in Menüs) | Öffnet Dropdown-Menüs |
| **1923** | U+21E1 | ⇡ | Pfeil hoch (in Menüs) | Schließt Dropdown-Menüs |
| **1924** | U+21D2 | ⇒ | Doppelpfeil rechts | Wird manchmal für Tastaturkürzel verwendet |
| **1925** | U+2313 | ⌓ | | Symbol für Bildschirm (historisch) |


---

## Block 2000-2099: Pfeile (Arrows) – In Browsern, Dokumenten und UI

Pfeile siehst du überall: in der Adressleiste (Zurück/Vor), in Buttons, in Menüs.

| Code | Unicode | Zeichen | Name | Anwendung/Fundort |
|------|---------|---------|------|-------------------|
| **2000** | U+2190 | ← | Pfeil links | Zurück-Button im Browser, Zurück-Navigation |
| **2001** | U+2191 | ↑ | Pfeil hoch | Hoch scrollen, "mehr laden" |
| **2002** | U+2192 | → | Pfeil rechts | Vor-Button im Browser, Weiter-Navigation |
| **2003** | U+2193 | ↓ | Pfeil runter | Runter scrollen, Dropdown-Menü öffnen |
| **2004** | U+2194 | ↔ | Pfeil links-rechts | Horizontales Verschieben |
| **2005** | U+2195 | ↕ | Pfeil hoch-runter | Vertikales Verschieben |
| **2006** | U+2196 | ↖ | Pfeil oben-links | Home (Dokumentenanfang) |
| **2007** | U+2197 | ↗ | Pfeil oben-rechts | (selten) |
| **2008** | U+2198 | ↘ | Pfeil unten-rechts | End (Dokumentenende) |
| **2009** | U+2199 | ↙ | Pfeil unten-links | (selten) |
| **2010** | U+21A9 | ↩ | Pfeil links mit Haken | Return-Taste, Wagenrücklauf |
| **2011** | U+21AA | ↪ | Pfeil rechts mit Haken | (selten) |
| **2012** | U+21B0 | ↰ | Pfeil hoch mit Haken links | (in Code-Umgebungen) |
| **2013** | U+21B1 | ↱ | Pfeil hoch mit Haken rechts | (in Code-Umgebungen) |
| **2014** | U+21B2 | ↲ | Pfeil runter mit Haken links | (in Code-Umgebungen) |
| **2015** | U+21B3 | ↳ | Pfeil runter mit Haken rechts | (in Code-Umgebungen) |
| **2016** | U+21BC | ↼ | Pfeil links mit Haken oben | (mathematisch) |
| **2017** | U+21BD | ↽ | Pfeil links mit Haken unten | (mathematisch) |
| **2018** | U+21C4 | ⇄ | Pfeil links-rechts übereinander | Austausch-Symbol |
| **2019** | U+21C5 | ⇅ | Pfeil hoch-runter übereinander | (selten) |
| **2020** | U+21D4 | ⇔ | Doppelpfeil links-rechts | "Genau dann, wenn" (Logik) |
| **2021** | U+21E7 | ⇧ | Shift-Symbol | (bereits in UI-Symbolen) |


---

## Block 2100-2199: Browser- und URL-spezifische Zeichen

Diese Zeichen siehst du ständig in der Adressleiste deines Browsers, in Buttons wie "Senden" und in E-Mail-Oberflächen.

### Adressleisten-Zeichen (Bestandteile von URLs)

| Code | Zeichen | Name | Bedeutung in URLs |
|------|---------|------|-------------------|
| **2100** | : | Doppelpunkt | Trennt Protokoll vom Rest (http:**//**...) |
| **2101** | / | Schrägstrich | Trennt Pfadbestandteile (website.com**/**seite**/**unterordner) |
| **2102** | . | Punkt | Trennt Domain-Teile (www**.**google**.**com) |
| **2103** | ? | Fragezeichen | Leitet die Query-String (Parameter) ein |
| **2104** | = | Gleich | Trennt Parameter-Name und -Wert (?seite**=**2) |
| **2105** | & | Und-Zeichen | Trennt mehrere Parameter (seite=2**&**sort=neu) |
| **2106** | # | Raute | Leitet einen Anker (Sprungmarke) ein (#kapitel3) |
| **2107** | % | Prozent | Kennzeichnet kodierte Zeichen (%20 = Leerzeichen) |
| **2108** | @ | At-Zeichen | In E-Mail-Adressen (name**@**domain.com) |
| **2109** | - | Bindestrich | In Domain-Namen (my**-**site.com) |
| **2110** | _ | Unterstrich | In Dateinamen und URLs (mein_datei.html) |
| **2111** | ~ | Tilde | Oft für Benutzerverzeichnisse (~benutzername) |
| **2112** | + | Plus | In Query-Strings (manchmal für Leerzeichen) |

### E-Mail-Button-Symbole (in Mail-Apps und Webmail)

| Code | Unicode | Zeichen | Name | Bedeutung/Fundort |
|------|---------|---------|------|-------------------|
| **2120** | U+2709 | ✉ | Briefumschlag | E-Mail allgemein, Posteingang |
| **2121** | U+1F4E7 | 📧 | E-Mail-Symbol | Moderne Variante des Briefumschlags |
| **2122** | U+1F4E8 | 📨 | Eingehende E-Mail | Nachricht empfangen |
| **2123** | U+1F4E9 | 📩 | Ausgehende E-Mail | Nachricht senden |
| **2124** | U+1F4E4 | 📤 | Ausgang (Outbox) | Postausgang |
| **2125** | U+1F4E5 | 📥 | Eingang (Inbox) | Posteingang |
| **2126** | U+270D | ✍ | Schreibende Hand | Neue Nachricht verfassen |
| **2127** | U+1F58B | 🖋 | Füllfederhalter | Schreiben, verfassen |
| **2128** | U+1F4DD | 📝 | Notizblock | Entwurf, neue Nachricht |
| **2129** | U+1F5AB | 🖫 | Papier mit Pfeil | Antworten (Reply) |
| **2130** | U+21A9 | ↩ | Pfeil links mit Haken | Antworten (oft in Webmail) |
| **2131** | U+21AA | ↪ | Pfeil rechts mit Haken | Weiterleiten (Forward) |
| **2132** | U+1F504 | 🔄 | Kreispfeile | Antworten an alle (Reply All) |
| **2133** | U+27F2 | ⟲ | Kreispfeil gegen Uhrzeiger | Aktualisieren, Neuladen |
| **2134** | U+1F5D1 | 🗑 | Papierkorb | Löschen |
| **2135** | U+1F5D3 | 🗓 | Kalender | Termin, Kalender |
| **2136** | U+1F4C5 | 📅 | Kalender (Blatt) | Datum, Kalender |
| **2137** | U+260E | ☎ | Telefon | Anruf, Kontakt |
| **2138** | U+1F4DE | 📞 | Telefonhörer | Anrufen |
| **2139** | U+1F4F1 | 📱 | Handy | Mobil |
| **2140** | U+1F4FA | 📺 | Fernseher | Video, Medien |
| **2141** | U+1F4CB | 📋 | Klemmbrett | Zwischenablage, kopieren |
| **2142** | U+1F4C4 | 📄 | Dokument (leer) | Datei, Dokument |
| **2143** | U+1F4C1 | 📁 | Ordner (geschlossen) | Ordner |
| **2144** | U+1F4C2 | 📂 | Ordner (geöffnet) | Geöffneter Ordner |
| **2145** | U+1F5C2 | 🗂 | Karteireiter | Sortieren, Kategorien |
| **2146** | U+1F50D | 🔍 | Lupe (links) | Suchen |
| **2147** | U+1F50E | 🔎 | Lupe (rechts) | Suchen, vergrößern |
| **2148** | U+2699 | ⚙ | Zahnrad | Einstellungen |
| **2149** | U+1F527 | 🔧 | Schraubenschlüssel | Einstellungen, Werkzeug |
| **2150** | U+1F512 | 🔒 | Schloss (geschlossen) | Sicher, verschlüsselt |
| **2151** | U+1F513 | 🔓 | Schloss (offen) | Nicht sicher, entsperrt |
| **2152** | U+1F510 | 🔐 | Schloss mit Schlüssel | Sicher, privat |
| **2153** | U+1F511 | 🔑 | Schlüssel | Passwort, Zugang |
| **2154** | U+1F4AC | 💬 | Sprechblase | Nachricht, Chat |
| **2155** | U+1F5E8 | 🗨 | Linke Sprechblase | Kommentar |
| **2156** | U+1F4AD | 💭 | Denkblase | Gedanke, Hinweis |
| **2157** | U+2B06 | ⬆ | Pfeil hoch (fett) | Hochladen (Upload) |
| **2158** | U+2B07 | ⬇ | Pfeil runter (fett) | Herunterladen (Download) |
| **2159** | U+27A4 | ➤ | Pfeil rechts (fett) | Senden, weiter |


---

## Block 2200-2299: Buttons und UI-Elemente (Opera, Browser, System)

Diese Symbole siehst du in Browsern wie Opera, Chrome oder Safari und in Systemdialogen.

### Browser-Buttons

| Code | Unicode | Zeichen | Name | Bedeutung |
|------|---------|---------|------|-----------|
| **2200** | U+2190 | ← | Zurück | Vorherige Seite |
| **2201** | U+2192 | → | Vor | Nächste Seite |
| **2202** | U+21BB | ↻ | Kreispfeil | Neu laden |
| **2203** | U+21BA | ↺ | Kreispfeil gegen Uhr | Neu laden (alternativ) |
| **2204** | U+2715 | ✕ | Schließen (X) | Tab schließen, Fenster schließen |
| **2205** | U+2716 | ✖ | Schließen (fettes X) | Schließen |
| **2206** | U+1F5D9 | 🗙 | X im Quadrat | Schließen-Button |
| **2207** | U+2296 | ⊖ | Minus im Kreis | Schließen (ältere Systeme) |
| **2208** | U+2295 | ⊕ | Plus im Kreis | Neu, hinzufügen |
| **2209** | U+271A | ✚ | Plus (fett) | Neuer Tab, hinzufügen |
| **2210** | U+1F5C4 | 🗄 | Aktenschrank | Lesezeichen, Verlauf |
| **2211** | U+1F5C3 | 🗃 | Karteikasten | Lesezeichen |
| **2212** | U+2606 | ☆ | Stern (leer) | Nicht favorisiert |
| **2213** | U+2605 | ★ | Stern (ausgefüllt) | Favorisiert, Lesezeichen gesetzt |
| **2214** | U+1F31F | 🌟 | Stern (glitzernd) | Hervorgehoben |
| **2215** | U+1F4F1 | 📱 | Handy | Mobile Ansicht |
| **2216** | U+1F4BB | 💻 | Computer | Desktop-Ansicht |
| **2217** | U+1F5A5 | 🖥 | Desktop-Computer | Vollbild, Desktop |
| **2218** | U+1F4D6 | 📖 | Offenes Buch | Lesezeichen, Leseliste |
| **2219** | U+1F4D1 | 📑 | Lesezeichen | Lesezeichen |
| **2220** | U+1F5C2 | 🗂 | Karteireiter | Tabs organisieren |
| **2221** | U+1F5A8 | 🖨 | Drucker | Drucken |
| **2222** | U+1F5AD | 🖭 | Scroll | Scrollen |

### Fenster- und Dialog-Buttons

| Code | Unicode | Zeichen | Name | Bedeutung |
|------|---------|---------|------|-----------|
| **2230** | U+2014 | — | (Strich) | Fenster minimieren (älter) |
| **2231** | U+1F5D5 | 🗕 | Minus im Quadrat | Minimieren |
| **2232** | U+1F5D6 | 🗖 | Zwei überlappende Quadrate | Maximieren |
| **2233** | U+1F5D7 | 🗗 | Zwei Quadrate | Maximieren (alternativ) |
| **2234** | U+1F5D8 | 🗘 | Kreispfeile im Quadrat | Wiederherstellen |
| **2235** | U+2754 | ❔ | Fragezeichen (weiß) | Hilfe |
| **2236** | U+2753 | ❓ | Fragezeichen (schwarz) | Hilfe |
| **2237** | U+203C | ‼ | Doppeltes Ausrufezeichen | Achtung, wichtig |
| **2238** | U+26A0 | ⚠ | Warndreieck | Warnung |
| **2239** | U+1F514 | 🔔 | Glocke | Benachrichtigung |
| **2240** | U+1F515 | 🔕 | Glocke durchgestrichen | Benachrichtigung aus |
| **2241** | U+1F4E2 | 📢 | Lautsprecher | Ankündigung, Broadcast |
| **2242** | U+1F4E3 | 📣 | Megaphon | Ankündigung |
| **2243** | U+1F4A1 | 💡 | Glühbirne | Tipp, Idee |
| **2244** | U+2757 | ❗ | Ausrufezeichen (fett) | Wichtig |
| **2245** | U+2714 | ✔ | Haken (fett) | OK, erledigt |
| **2246** | U+2713 | ✓ | Haken | OK, erledigt |
| **2247** | U+274C | ❌ | X (rot) | Fehler, abgebrochen |
| **2248** | U+2705 | ✅ | Haken im weißen Quadrat | Erfolg, bestätigt |


---

## Block 2300-2399: Operatoren und Logik (In Programmierung und Mathematik)

Diese Zeichen siehst du in Code-Editoren, Terminals und wenn du programmierst.

| Code | Unicode | Zeichen | Name | Bedeutung |
|------|---------|---------|------|-----------|
| **2300** | U+0026 | & | Und | Bitweises UND, logisches UND |
| **2301** | U+007C | \| | Pipe (senkrechter Strich) | Bitweises ODER, logisches ODER |
| **2302** | U+005E | ^ | Zirkumflex | Bitweises XOR (exklusiv-ODER) |
| **2303** | U+007E | ~ | Tilde | Bitweise Negation (NOT), Home-Verzeichnis |
| **2304** | U+003C | < | Kleiner-als | Vergleich, Eingabeumleitung (Shell) |
| **2305** | U+003E | > | Größer-als | Vergleich, Ausgabeumleitung (Shell) |
| **2306** | U+003C 003C | << | Doppelkleiner | Bitweise Linksverschiebung |
| **2307** | U+003E 003E | >> | Doppelgrößer | Bitweise Rechtsverschiebung |
| **2308** | U+0021 003D | != | Ungleich | Vergleich (in vielen Sprachen) |
| **2309** | U+003D 003D | == | Gleich (Vergleich) | Vergleich (in vielen Sprachen) |
| **2310** | U+003D 003D 003D | === | Strikt gleich | Vergleich (JavaScript) |
| **2311** | U+0021 003D 003D | !== | Strikt ungleich | Vergleich (JavaScript) |
| **2312** | U+0026 0026 | && | UND (logisch) | Logisches UND (in Programmierung) |
| **2313** | U+007C 007C | \|\| | ODER (logisch) | Logisches ODER (in Programmierung) |
| **2314** | U+002B | + | Plus | Addition, String-Verkettung |
| **2315** | U+002D | - | Minus | Subtraktion |
| **2316** | U+002A | * | Stern | Multiplikation, Zeiger (C) |
| **2317** | U+002F | / | Slash | Division, Pfadtrenner |
| **2318** | U+0025 | % | Prozent | Modulo (Rest einer Division) |
| **2319** | U+002B 002B | ++ | Inkrement | Erhöhen um 1 (Programmierung) |
| **2320** | U+002D 002D | -- | Dekrement | Verringern um 1 (Programmierung) |
| **2321** | U+003F | ? | Fragezeichen | Ternärer Operator, Optional |
| **2322** | U+003A | : | Doppelpunkt | Trenner, Typangabe |
| **2323** | U+003B | ; | Semikolon | Befehlsende (in vielen Sprachen) |
| **2324** | U+002C | , | Komma | Trenner in Listen, Parametern |
| **2325** | U+002E | . | Punkt | Objekt-Zugriff (Programmierung) |
| **2326** | U+002E 002E 002E | ... | Drei Punkte | Rest-Operator, Spread (JavaScript) |
| **2327** | U+0023 | # | Raute | Präprozessor, Kommentar (Python) |
| **2328** | U+002F 002F | // | Doppelslash | Kommentar (C, Java, JavaScript) |
| **2329** | U+002F 002A | /* | Slash-Stern | Kommentarbeginn (C) |
| **2330** | U+002A 002F | */ | Stern-Slash | Kommentarende (C) |
| **2331** | U+007B | { | Geschweifte Klammer auf | Blockbeginn |
| **2332** | U+007D | } | Geschweifte Klammer zu | Blockende |
| **2333** | U+005B | [ | Eckige Klammer auf | Array-Zugriff |
| **2334** | U+005D | ] | Eckige Klammer zu | Array-Zugriff |
| **2335** | U+0028 | ( | Runde Klammer auf | Funktionsaufruf, Gruppierung |
| **2336** | U+0029 | ) | Runde Klammer zu | Funktionsaufruf, Gruppierung |


---

## Block 2400-2499: Terminal und Kommandozeile

Diese Zeichen siehst du, wenn du das Terminal öffnest (Code 801 im Windows-Telekolleg) oder in der macOS-Konsole arbeitest.

| Code | Zeichen | Name | Bedeutung im Terminal |
|------|---------|------|------------------------|
| **2400** | $ | Dollarzeichen | Prompt für normale Benutzer (Unix-Shell) |
| **2401** | # | Raute | Prompt für root (Administrator) |
| **2402** | % | Prozent | Prompt (in C-Shell) |
| **2403** | > | Größer-als | Prompt (in manchen Shells) |
| **2404** | ~ | Tilde | Home-Verzeichnis des Benutzers |
| **2405** | / | Slash | Wurzelverzeichnis, Pfadtrenner (Unix) |
| **2406** | \ | Backslash | Pfadtrenner (Windows) |
| **2407** | . | Punkt | Aktuelles Verzeichnis |
| **2408** | .. | Doppelpunkt | Übergeordnetes Verzeichnis |
| **2409** | * | Stern | Wildcard (beliebige Zeichen) |
| **2410** | ? | Fragezeichen | Wildcard (ein beliebiges Zeichen) |
| **2411** | [ ] | Eckige Klammern | Zeichenklasse in Wildcards |
| **2412** | \| | Pipe | Verkettet Befehle (Ausgabe als Eingabe) |
| **2413** | & | Und | Führt Befehl im Hintergrund aus |
| **2414** | && | Doppel-Und | Führt zweiten Befehl nur bei Erfolg aus |
| **2415** | \|\| | Doppel-Pipe | Führt zweiten Befehl nur bei Fehler aus |
| **2416** | ; | Semikolon | Trennt mehrere Befehle in einer Zeile |
| **2417** | > | Größer-als | Leitet Ausgabe in Datei um (überschreibt) |
| **2418** | >> | Doppelgrößer | Leitet Ausgabe in Datei um (hängt an) |
| **2419** | < | Kleiner-als | Liest Eingabe aus Datei |
| **2420** | << | Doppelkleiner | Here-Dokument (mehrzeilige Eingabe) |
| **2421** | 2> | 2> | Leitet Fehlerausgabe um |
| **2422** | &> | &> | Leitet alle Ausgaben um |
| **2423** | ` ` | Backticks | Führt Befehl aus und setzt Ergebnis ein |
| **2424** | $() | Dollar-Klammern | Moderne Variante von Backticks |
| **2425** | ${} | Dollar-Klammern | Variablen-Expansion |
| **2426** | $(()) | Dollar-Doppelklammern | Arithmetische Expansion |
| **2427** | [[ ]] | Doppelte Klammern | Testausdruck (in Bash) |
| **2428** | $? | Dollar-Fragezeichen | Exit-Code des letzten Befehls |
| **2429** | $$ | Dollar-Dollar | Prozess-ID der aktuellen Shell |
| **2430** | $! | Dollar-Ausrufezeichen | Prozess-ID des letzten Hintergrundjobs |
| **2431** | $0 | Dollar-Null | Name des Skripts |
| **2432** | $1 ... $9 | Dollar-Zahl | Parameter des Skripts |
| **2433** | $# | Dollar-Raute | Anzahl der Parameter |
| **2434** | $@ | Dollar-At | Alle Parameter |
| **2435** | $* | Dollar-Stern | Alle Parameter (als ein String) |


---

## Block 2500-2599: Moderne Unicode-Symbole und Emojis

Der Mac kann über 150.000 Unicode-Zeichen darstellen . Hier eine Auswahl der wichtigsten.

### Smileys und Emotionen

| Code | Unicode | Zeichen | Name |
|------|---------|---------|------|
| **2500** | U+1F600 | 😀 | Grinsendes Gesicht |
| **2501** | U+1F603 | 😃 | Grinsendes Gesicht mit großen Augen |
| **2502** | U+1F604 | 😄 | Grinsendes Gesicht mit lachenden Augen |
| **2503** | U+1F601 | 😁 | Strahlendes Gesicht mit lachenden Augen |
| **2504** | U+1F606 | 😆 | Grinsendes Gesicht mit zusammengekniffenen Augen |
| **2505** | U+1F605 | 😅 | Grinsendes Gesicht mit Schweiß |
| **2506** | U+1F923 | 🤣 | Auf dem Boden rollen vor Lachen |
| **2507** | U+1F602 | 😂 | Gesicht mit Freudentränen |
| **2508** | U+1F642 | 🙂 | Leicht lächelndes Gesicht |
| **2509** | U+1F643 | 🙃 | Umgekehrtes Gesicht |
| **2510** | U+1F609 | 😉 | Zwinkerndes Gesicht |
| **2511** | U+1F60A | 😊 | Lächelndes Gesicht mit lächelnden Augen |
| **2512** | U+1F607 | 😇 | Lächelndes Gesicht mit Heiligenschein |
| **2513** | U+1F60D | 😍 | Lächelndes Gesicht mit Herzaugen |
| **2514** | U+1F929 | 🤩 | Verliebtes Gesicht mit Sternchenaugen |
| **2515** | U+1F618 | 😘 | Küssendes Gesicht mit Herzen |
| **2516** | U+1F617 | 😗 | Küssendes Gesicht |
| **2517** | U+1F61A | 😚 | Küssendes Gesicht mit geschlossenen Augen |
| **2518** | U+1F619 | 😙 | Küssendes Gesicht mit lächelnden Augen |
| **2519** | U+1F60B | 😋 | Lecker |
| **2520** | U+1F61B | 😛 | Gesicht mit herausgestreckter Zunge |
| **2521** | U+1F61C | 😜 | Gesicht mit herausgestreckter Zunge und zwinkerndem Auge |
| **2522** | U+1F92A | 🤪 | Verrücktes Gesicht |
| **2523** | U+1F61D | 😝 | Gesicht mit herausgestreckter Zunge und zusammengekniffenen Augen |
| **2524** | U+1F911 | 🤑 | Geldgesicht |
| **2525** | U+1F917 | 🤗 | Umarmendes Gesicht |
| **2526** | U+1F92D | 🤭 | Gesicht mit Hand vor dem Mund |
| **2527** | U+1F92B | 🤫 | Leise |
| **2528** | U+1F914 | 🤔 | Nachdenkendes Gesicht |
| **2529** | U+1F910 | 🤐 | Gesicht mit Reißverschlussmund |
| **2530** | U+1F928 | 🤨 | Gesicht mit hochgezogener Augenbraue |
| **2531** | U+1F610 | 😐 | Neutrales Gesicht |
| **2532** | U+1F611 | 😑 | Ausdrucksloses Gesicht |
| **2533** | U+1F636 | 😶 | Gesicht ohne Mund |
| **2534** | U+1F60F | 😏 | Selbstgefälliges Gesicht |
| **2535** | U+1F612 | 😒 | Unbeeindrucktes Gesicht |
| **2536** | U+1F644 | 🙄 | Gesicht mit rollenden Augen |
| **2537** | U+1F62C | 😬 | Grimasse schneidendes Gesicht |
| **2538** | U+1F925 | 🤥 | Lügendes Gesicht |
| **2539** | U+1F60C | 😌 | Erleichtertes Gesicht |
| **2540** | U+1F614 | 😔 | Nachdenkliches Gesicht |
| **2541** | U+1F62A | 😪 | Schläfriges Gesicht |
| **2542** | U+1F924 | 🤤 | Sabberndes Gesicht |
| **2543** | U+1F634 | 😴 | Schlafendes Gesicht |
| **2544** | U+1F637 | 😷 | Gesicht mit medizinischer Maske |
| **2545** | U+1F912 | 🤒 | Gesicht mit Fieberthermometer |
| **2546** | U+1F915 | 🤕 | Gesicht mit Kopfverband |
| **2547** | U+1F922 | 🤢 | Übelkeit |
| **2548** | U+1F92E | 🤮 | Kotzendes Gesicht |
| **2549** | U+1F927 | 🤧 | Niesendes Gesicht |
| **2550** | U+1F975 | 🥵 | Hitziges Gesicht |
| **2551** | U+1F976 | 🥶 | Kaltes Gesicht |
| **2552** | U+1F974 | 🥴 | Betrunkenes Gesicht |
| **2553** | U+1F635 | 😵 | Schwindliges Gesicht |
| **2554** | U+1F92F | 🤯 | Explodierender Kopf |
| **2555** | U+1F920 | 🤠 | Cowboyhut-Gesicht |
| **2556** | U+1F973 | 🥳 | Party-Gesicht |
| **2557** | U+1F978 | 🥸 | Verkleidetes Gesicht |
| **2558** | U+1F60E | 😎 | Lächelndes Gesicht mit Sonnenbrille |
| **2559** | U+1F913 | 🤓 | Streber-Gesicht |
| **2560** | U+1F9D0 | 🧐 | Gesicht mit Monokel |


---

## Block 2600-2699: Die Zeichenpalette – Dein Werkzeug zum Finden

Der Mac hat ein mächtiges Werkzeug, um JEDES Zeichen zu finden – die **Zeichenpalette** (Character Viewer) .

### 26.1 So öffnest du die Zeichenpalette

| Methode | Tastenkombination |
|---------|-------------------|
| Tastatur | **Fn + E** (auf vielen neueren Macs) |
| Tastatur | **Globus-Taste + E** |
| Tastatur | **Control + Command + Leertaste** |
| Menü | "Bearbeiten" → "Emoji & Symbole" |

### 26.2 Was die Zeichenpalette bietet

- **Emojis** – Alle Smileys und Bildsymbole
- **Pfeile** – ← ↑ → ↓ ↔ ↕ ↖ ↗ ↘ ↙
- **Klammern und Satzzeichen** – Auch typografische Varianten
- **Währungssymbole** – € $ £ ¥ ¢ ₽ ₿
- **Mathematische Symbole** – ≠ ≤ ≥ ∞ √ ∑ ∫ ∂
- **Lateinische Buchstaben mit Akzenten** – Für alle Sprachen
- **Technische Symbole** – ⌘ ⌥ ⌃ ⇧ ⌫ ⌦ ⎋ ⏏
- **Weitere Kategorien** – Musik, Sternzeichen, Verkehr, etc.

### 26.3 Suchen nach Hex-Code

Du kannst in der Zeichenpalette direkt nach dem **Unicode-Hex-Code** suchen. Tippe z.B. "20AC" ein, und das Euro-Zeichen wird gefunden .

### 26.4 Favoriten anlegen

Wenn du bestimmte Zeichen oft brauchst:
1. Zeichen in der Palatte suchen
2. Rechtsklick (oder zweifingrig) auf das Zeichen
3. "Zu Favoriten hinzufügen" wählen
4. Die Favoriten erscheinen immer ganz oben


---

## Block 2700-2799: Unicode Hex Input – Die Profi-Methode

Für Fortgeschrittene: Mit "Unicode Hex Input" kannst du **jedes Unicode-Zeichen** über seinen vierstelligen Hex-Code eingeben .

### 27.1 So richtest du Unicode Hex Input ein

1. **Systemeinstellungen** → **Tastatur**
2. Gehe zu "Texteingabe" → **"Eingabequellen"**
3. Klicke auf **"Bearbeiten"** und dann auf das **Plus-Symbol (+)** unten links
4. Scrolle runter zu **"Weitere"** und wähle **"Unicode Hex Input"**
5. Klicke auf "Hinzufügen" und dann auf "Fertig" 

### 27.2 So verwendest du Unicode Hex Input

1. **Wechsle zur Unicode-Tastatur** (oben rechts in der Menüleiste "U+" auswählen)
2. **Halte die Option-Taste (⌥) gedrückt**
3. **Tippe den vierstelligen Hex-Code** (nur Zeichen A-F und 0-9)
4. **Lass Option los** – das Zeichen erscheint 

### 27.3 Wichtige Hex-Codes

| Zeichen | Unicode | Hex-Code | Name |
|---------|---------|----------|------|
| © | U+00A9 | 00A9 | Copyright |
| ® | U+00AE | 00AE | Registered |
| ™ | U+2122 | 2122 | Trademark |
| € | U+20AC | 20AC | Euro |
| £ | U+00A3 | 00A3 | Pfund |
| ¥ | U+00A5 | 00A5 | Yen |
| ° | U+00B0 | 00B0 | Grad |
| ± | U+00B1 | 00B1 | Plus-Minus |
| ≠ | U+2260 | 2260 | Ungleich |
| ≤ | U+2264 | 2264 | Kleiner-gleich |
| ≥ | U+2265 | 2265 | Größer-gleich |
| ∞ | U+221E | 221E | Unendlich |
| π | U+03C0 | 03C0 | Pi |
| Ω | U+03A9 | 03A9 | Omega |
| ← | U+2190 | 2190 | Pfeil links |
| ↑ | U+2191 | 2191 | Pfeil hoch |
| → | U+2192 | 2192 | Pfeil rechts |
| ↓ | U+2193 | 2193 | Pfeil runter |
| ♥ | U+2665 | 2665 | Herz |
| ★ | U+2605 | 2605 | Stern ausgefüllt |
| ✓ | U+2713 | 2713 | Haken |
| ✗ | U+2717 | 2717 | Kreuz |
|  | U+F8FF | F8FF | **Apple-Logo**  |


---

## Block 2800-2899: Praktische Anwendung – Fundorte aller Zeichen

Hier siehst du, wo du die verschiedenen Zeichen im Alltag findest.

| Zeichengruppe | Fundort | Beispiele |
|---------------|---------|-----------|
| Buchstaben A-Z, a-z | Überall | Texte, Dokumente, URLs |
| Ziffern 0-9 | Überall | Zahlen, Preise, Datum |
| Satzzeichen | Überall | . , : ; ! ? |
| Umlaute (ä ö ü ß) | Deutsche Texte | Briefe, Dokumente |
| UI-Symbole (⌘ ⌥ ⌃) | Mac-Menüs, Tastaturkürzel | Menüleiste, Programm-Menüs |
| Pfeile (← → ↑ ↓) | Browser, Navigation | Zurück/Vor-Buttons, Scrollen |
| Währungssymbole (€ $ £) | Preise, Rechnungen | Online-Shops, Excel |
| Typografische Zeichen (– — „“) | Professionelle Dokumente | Bücher, Artikel |
| Mathematische Symbole (≠ ≤ ≥) | Formeln, Programmierung | Excel, Code |
| Emojis (😀 🎉 ❤️) | Chat, Social Media | Nachrichten, WhatsApp |
| URL-Zeichen (:/?#@) | Adressleiste | Browser |
| Terminal-Zeichen ($ # ~) | Terminal-App | Kommandozeile |
| Rahmenzeichen (┌ ─ ┐) | Alte DOS-Programme | Historische Dokumente |


---

## Block 2900-2999: Problembehandlung – Wenn Zeichen nicht erscheinen

### 29.1 "Ich sehe nur Kästchen oder Fragezeichen"

**Ursache:** Die verwendete Schriftart enthält dieses Zeichen nicht, oder die Zeichenkodierung ist falsch.

**Lösungen:**
- Andere Schriftart ausprobieren
- Dokument in UTF-8 speichern (modernes Standard-Encoding) 
- Zeichen über Zeichenpalette einfügen

### 29.2 "Das Apple-Logo () wird auf anderen Geräten nicht angezeigt"

**Ursache:** Das Apple-Logo (U+F8FF) liegt im "Private Use Area" von Unicode und ist nur auf Apple-Geräten sichtbar .

**Lösung:** Verwende es nur in Dokumenten, die auf Apple-Geräten bleiben. Für plattformunabhängige Dokumente lieber das Wort "Apple" ausschreiben.

### 29.3 "Ich finde ein bestimmtes Zeichen nicht"

**Lösungen:**
1. **Zeichenpalette öffnen** (Fn + E) und suchen
2. **Symbl.cc** besuchen – riesige Unicode-Datenbank 
3. **Google-Suche:** "Unicode [Zeichenname]" (z.B. "Unicode Euro symbol")
4. **In der Zeichenpalette Hex-Code eingeben**

### 29.4 "Die Tastenkombination funktioniert nicht"

- Prüfe, ob die richtige Tastaturbelegung aktiv ist (Deutsch, nicht etwa Englisch)
- In manchen Programmen (z.B. Terminal) können Tastaturkürzel anders sein
- Verwende alternativ die Zeichenpalette


---

## Abschluss: Du hast jetzt die ultimative Mac-Zeichen-Bibliothek

**Das ist deine vollständige Enzyklopädie aller sichtbaren Zeichen auf dem Mac.** Von 1000 bis 2999 – jedes Zeichen hat einen Code, einen Namen und eine Funktion.

### Die wichtigsten Erkenntnisse:

1. **Die Basis (1000-1399)** ist auf allen Systemen identisch: Steuerzeichen, Satzzeichen, Buchstaben, Ziffern.

2. **MacRoman (1400-1899)** ist der historische 8-Bit-Zeichensatz des Mac – wichtig für alte Dokumente.

3. **UI-Symbole (1900-1999)** sind einzigartig für den Mac: ⌘ ⌥ ⌃ ⇧ ⌫ – die Sprache der Menüs.

4. **Pfeile und Browser-Zeichen (2000-2199)** siehst du in der Adressleiste, in Buttons und Navigation.

5. **E-Mail-Buttons (2120-2159)** kennzeichnen Funktionen wie Senden, Löschen, Antworten.

6. **Terminal-Zeichen (2400-2499)** brauchst du, wenn du mit der Kommandozeile arbeitest.

7. **Emojis (2500-2599)** – die moderne Bildsprache.

8. **Unicode Hex Input (2700-2799)** ist die Profi-Methode für über 150.000 Zeichen.

9. **Die Zeichenpalette (2600-2699)** ist dein Werkzeug, um jedes Zeichen zu finden.

Mit diesem Wissen kannst du JEDES Zeichen auf deinem Mac:
- **Erkennen** (Was ist das für ein komisches Symbol?)
- **Eingeben** (Wie bekomme ich dieses Zeichen?)
- **Verstehen** (Wofür wird es verwendet?)
- **Finden** (Wo ist es in der Zeichenpalette?)

**Die Welt der Zeichen steht dir offen.** Von NUL (1000) bis zum letzten Emoji (2599) – du hast den Schlüssel zu allen.