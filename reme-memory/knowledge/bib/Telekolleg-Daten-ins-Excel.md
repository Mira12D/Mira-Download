# Telekolleg Excel Teil 2: Daten aus dem Internet, aus Dokumenten und anderswo in Excel bekommen

## Ein Brief für absolute Anfänger – Alles über den Weg der Daten nach Excel

Hallo und herzlich willkommen zum zweiten Teil unseres Excel-Telekollegs! Im ersten Teil hast du gelernt, wie man Tabellen baut, Rechnungen schreibt und Formeln verwendet. Aber eine Frage ist offen geblieben: Wo kommen eigentlich die Daten her?

Stell dir vor, du hast eine Liste in einem Google Doc, eine Tabelle auf einer Webseite, oder jemand schickt dir eine Datei per E-Mail. Und jetzt willst du all das in Excel haben, um damit zu rechnen, zu sortieren oder zu analysieren. Wie bekommst du die Daten da rein?

In diesem Brief zeige ich dir ALLE Wege – von ganz einfach bis etwas fortgeschrittener. Und wie immer: Jeder Schritt wird erklärt, als ob du noch nie etwas damit zu tun hattest.

---

## Kapitel 1: Die verschiedenen Arten von Daten – Was kann woher kommen?

Bevor wir loslegen, ist es wichtig zu verstehen: Daten können in vielen verschiedenen Verpackungen daherkommen.

### 1.1 Daten aus dem Internet (Webseiten)

- Eine Tabelle mit Preisen auf einer Shopping-Seite
- Eine Liste von Öffnungszeiten auf einer Firmenwebseite
- Aktienkurse, Wetterdaten, Sporttabellen

### 1.2 Daten aus Google Docs (Textdokumente)

- Eine Tabelle, die du in Google Docs geschrieben hast
- Eine Liste mit Namen und Adressen
- Ein Rezept mit Zutaten und Mengen

### 1.3 Daten aus Google Sheets (andere Tabellen)

- Jemand hat dir eine Google Tabelle geschickt
- Du hast selbst eine Tabelle in Google Sheets und willst sie in Excel weiterverwenden

### 1.4 Daten aus PDF-Dateien

- Eine Rechnung, die dir als PDF geschickt wurde
- Ein Formular, das du ausfüllen musst
- Ein eingescanntes Dokument

### 1.5 Daten aus einfachen Textdateien

- CSV-Dateien (Comma-Separated Values) – das sind Textdateien, bei denen die Daten durch Kommas getrennt sind
- TXT-Dateien mit Listen

**Für jeden dieser Wege gibt es eine Lösung. Und die zeige ich dir jetzt.**

---

## Kapitel 2: Daten aus dem Internet in Excel bekommen (Webseiten)

Du siehst auf einer Webseite eine Tabelle, zum Beispiel mit aktuellen Euro-Umrechnungskursen oder einer Liste deiner Lieblingsbücher. Die willst du in Excel haben, ohne alles abzutippen.

### 2.1 Der einfache Weg: Kopieren und Einfügen (für kleine Tabellen)

Wenn die Tabelle auf der Webseite nicht riesig ist, ist das die schnellste Methode.

**Schritt für Schritt:**

1. **Öffne deinen Browser** und gehe zu der Webseite mit der Tabelle.
2. **Markiere die Tabelle:**
   - Mit der Maus: Klicke oben links in die Tabelle, halte die linke Maustaste gedrückt und ziehe bis unten rechts. Dann loslassen.
   - Mit der Tastatur: Gehe mit Tab oder Pfeiltasten in die Tabelle. Das ist manchmal schwierig. Versuche, mit der Maus zu markieren oder drücke **Strg + A** (alles markieren) – aber dann markierst du vielleicht die ganze Seite. Besser: Mit Shift + Pfeiltasten vorsichtig markieren.
3. **Kopieren:** Drücke **Strg + C** (Windows) oder **Befehl + C** (Mac).
4. **Gehe zu Excel** (oder Google Tabellen) und klicke in die Zelle, wo die Tabelle beginnen soll (z.B. A1).
5. **Einfügen:** Drücke **Strg + V** (Windows) oder **Befehl + V** (Mac).

**Was passiert?** Oft funktioniert das erstaunlich gut. Die Tabelle landet mit allen Zeilen und Spalten in Excel. Manchmal ist die Formatierung etwas durcheinander, aber die Daten sind da.

**Problem:** Wenn die Tabelle auf der Webseite kompliziert ist oder Bilder enthält, kann es schiefgehen. Dann probiere die nächste Methode.

### 2.2 Der bessere Weg: Datenabruf mit "Aus Web" (nur in Excel für Windows)

Excel hat eine eingebaute Funktion, um direkt Daten aus dem Internet zu holen. Die heißt **"Aus Web"** (oder "From Web").

**Achtung:** Diese Funktion gibt es in Excel für Windows. Auf dem Mac ist sie nicht direkt vorhanden . Für Mac-Nutzer zeige ich später einen Umweg.

**Schritt für Schritt (Windows):**

1. **Öffne Excel** und dein Tabellenblatt.
2. Gehe oben auf das Menü **"Daten"** (Data).
3. Suche nach dem Button **"Aus Web"** (From Web). (Manchmal versteckt unter "Daten abrufen" → "Aus anderen Quellen" → "Aus Web".)
4. **Ein Fenster öffnet sich.** Hier musst du die **Adresse (URL) der Webseite** eingeben, auf der die Tabelle ist. Also z.B. `www.example.com/tabelle`.
5. Klicke auf **"OK"**.
6. Excel verbindet sich jetzt mit der Webseite. Das kann ein paar Sekunden dauern.
7. **Es öffnet sich ein neues Fenster** (Navigator). Hier siehst du eine Vorschau. Excel zeigt dir an, welche Tabellen es auf der Seite gefunden hat. Oft gibt es mehrere (z.B. "Table 0", "Table 1").
8. Klicke auf eine der Tabellen in der Liste. Rechts siehst du eine Vorschau.
9. Wenn die richtige Tabelle angezeigt wird, klicke unten auf **"Laden"** (Load).
10. **Fertig!** Die Daten landen in einem neuen Tabellenblatt in Excel.

**Das Besondere:** Wenn du später auf "Daten" → "Alle aktualisieren" klickst, holt Excel die Daten NEU von der Webseite. Wenn sich die Kurse oder Preise geändert haben, werden sie aktualisiert. Das nennt man **Live-Daten**.

### 2.3 Der Umweg für Mac-Nutzer

Auf dem Mac fehlt die direkte "Aus Web"-Funktion. Aber es gibt einen Weg :

1. **Öffne die Webseite** in deinem Browser (Safari, Chrome).
2. **Markiere die Tabelle** und kopiere sie (Strg + C / Befehl + C).
3. **Öffne Excel** und füge ein (Strg + V / Befehl + V).
4. **Alternative:** Speichere die Webseite als HTML-Datei (im Browser: "Seite speichern unter"). Dann in Excel: "Daten" → "Aus Text/CSV" und wähle die HTML-Datei aus. Das ist etwas komplizierter, funktioniert aber manchmal.

---

## Kapitel 3: Daten aus Google Docs nach Excel bringen

Das ist der Klassiker: Du hast in Google Docs eine Tabelle geschrieben (z.B. eine Liste, einen Stundenplan, eine Adressliste) und willst sie in Excel weiterverarbeiten.

### 3.1 Methode 1: Kopieren und Einfügen (für Tabellen)

Wenn deine Daten in Google Docs als **Tabelle** formatiert sind, ist das am einfachsten .

**Schritt für Schritt:**

1. **Öffne dein Google Doc.**
2. **Suche die Tabelle.** Sie sollte sauber sein: Keine zusammengefügten Zellen (merged cells), wenn möglich. Die Kopfzeile sollte klar sein.
3. **Markiere die gesamte Tabelle.** Klicke in die obere linke Zelle, halte die Maus gedrückt und ziehe bis zur unteren rechten Zelle. Oder klicke einmal in die Tabelle, dann erscheint oben links ein kleines Quadrat mit vier Pfeilen – wenn du darauf klickst, ist die ganze Tabelle markiert.
4. **Kopieren:** Drücke **Strg + C** (Windows) oder **Befehl + C** (Mac). Oder Rechtsklick → "Kopieren".
5. **Öffne Excel** (oder Google Tabellen, falls du dort weiterarbeiten willst).
6. **Klicke in die Zelle A1** (oder wo die Tabelle beginnen soll).
7. **Einfügen:** Drücke **Strg + V** (Windows) oder **Befehl + V** (Mac).
8. **Wichtig:** Beim Einfügen hast du Optionen. Direkt nach dem Einfügen erscheint ein kleines Symbol (Einfügeoptionen). Dort kannst du wählen:
   - "Quellformatierung beibehalten" (die Schriftarten und Farben aus Google Docs bleiben)
   - "Zielformatierung übernehmen" (Excel passt die Tabelle an dein aktuelles Design an) – das ist oft sauberer .
9. **Fertig.** Deine Tabelle ist jetzt in Excel.

### 3.2 Methode 2: Wenn der Text nicht in einer Tabelle ist (sondern als Liste)

Manchmal sind die Daten nicht als Tabelle, sondern als einfache Liste geschrieben, z.B.:

```
Äpfel, 2,50, 2 Kilo
Brot, 3,20, 1 Laib
Milch, 1,80, 3 Liter
```

Oder mit Tabs oder Leerzeichen getrennt. Das nennt man **"delimitierten Text"** (Text mit Trennzeichen) .

**So bekommst du das nach Excel:**

1. **Markiere die Liste** im Google Doc und kopiere sie (Strg + C).
2. **Öffne Excel** und klicke in Zelle A1.
3. **Einfügen** (Strg + V). Jetzt steht erstmal ALLES in EINER Spalte (Spalte A). Das ist okay.
4. **Jetzt kommt der Trick: "Text in Spalten"**
   - Markiere die Spalte A (klicke auf den Buchstaben A oben).
   - Gehe oben ins Menü **"Daten"** (Data).
   - Suche den Button **"Text in Spalten"** (Text to Columns).
   - **Ein Fenster öffnet sich.** Es fragt: "Welchen Trennzeichen-Typ möchten Sie?" Wähle **"Getrennt"** (Delimited). Klicke "Weiter".
   - **Jetzt die Trennzeichen:** Hier sagst du Excel, wie deine Daten getrennt sind. Meistens ist es ein Komma, ein Semikolon oder ein Tab. Entferne alle Häkchen außer dem richtigen. Wenn du Kommas in der Liste hast, setze ein Häkchen bei "Komma". Unten siehst du eine Vorschau, wie die Daten aufgeteilt werden.
   - Klicke "Weiter" und dann "Fertig".
5. **Zack!** Die Daten sind jetzt auf mehrere Spalten verteilt .

### 3.3 Methode 3: Umweg über Word (für komplizierte Fälle)

Wenn das direkte Kopieren nicht klappt, gibt es einen Umweg :

1. **Im Google Doc:** Gehe auf **"Datei"** → **"Herunterladen"** → **"Microsoft Word (.docx)"**.
2. **Öffne die heruntergeladene Datei** in Word.
3. **In Word:** Markiere die Tabelle, kopiere sie (Strg + C).
4. **In Excel:** Füge ein (Strg + V).
5. Manchmal funktioniert das besser, weil Word und Excel aus demselben Haus (Microsoft) kommen und besser miteinander können.

### 3.4 Methode 4: Als Textdatei herunterladen und importieren 

Für große Dokumente oder wenn das Kopieren nicht sauber klappt:

1. **Im Google Doc:** Gehe auf **"Datei"** → **"Herunterladen"** → **"Plain Text (.txt)"**.
2. **Öffne Excel.**
3. Gehe auf **"Daten"** → **"Aus Text/CSV"** (From Text/CSV).
4. **Wähle die .txt-Datei** aus, die du gerade heruntergeladen hast.
5. Excel öffnet ein Vorschaufenster und versucht automatisch zu erkennen, wie die Daten getrennt sind (z.B. durch Kommas oder Tabs). Wenn die Vorschau gut aussieht, klicke auf **"Laden"** (Load).
6. Die Daten landen in Excel.

---

## Kapitel 4: Daten aus Google Sheets nach Excel bringen

Das ist eigentlich am einfachsten, weil Google Sheets und Excel ja beides Tabellenprogramme sind.

### 4.1 Methode 1: Herunterladen als Excel-Datei 

1. **Öffne deine Tabelle in Google Sheets.**
2. Gehe auf **"Datei"** → **"Herunterladen"** → **"Microsoft Excel (.xlsx)"**.
3. Der Browser fragt dich, wo du die Datei speichern willst. Wähle einen Ordner (z.B. "Downloads" oder "Dokumente").
4. **Fertig!** Du hast jetzt eine echte Excel-Datei auf deinem Computer. Die kannst du doppelklicken, sie öffnet sich in Excel.

### 4.2 Methode 2: Per E-Mail senden 

Du kannst eine Google Tabelle auch direkt als Excel-Datei per E-Mail verschicken:

1. **In Google Sheets:** Gehe auf **"Datei"** → **"Als E-Mail-Anhang senden"**.
2. Wähle unter "Anhängen als" die Option **"Microsoft Excel"** aus.
3. Gib die E-Mail-Adresse ein, und klicke auf "Senden".
4. Der Empfänger bekommt eine Excel-Datei im Anhang.

### 4.3 Methode 3: Kopieren und Einfügen

Wenn du nur einen Teil der Tabelle brauchst, kannst du auch einfach markieren, kopieren (Strg + C) und in Excel einfügen (Strg + V). Das funktioniert meistens problemlos.

---

## Kapitel 5: Daten aus PDF-Dateien nach Excel bringen

PDF ist manchmal eine Nervensäge, weil es wie ein eingefrorenes Bild ist. Aber es gibt Wege.

### 5.1 Methode 1: Einfach probieren – Kopieren und Einfügen

Manchmal ist es ganz simpel:

1. **Öffne die PDF-Datei** (mit Adobe Acrobat Reader oder im Browser).
2. **Markiere die Tabelle** mit der Maus (klicken, ziehen).
3. **Kopieren** (Strg + C).
4. **In Excel einfügen** (Strg + V).
5. **Oft klappt das erstaunlich gut!** Die Tabelle landet in Excel.

### 5.2 Methode 2: Umweg über Google 

Google hat ein verstecktes Talent: Es kann PDFs oft ganz gut lesen.

1. **Gehe auf Google Drive** (drive.google.com) und melde dich an.
2. **Lade die PDF-Datei hoch:** Klicke auf "Neu" → "Datei hochladen" und wähle die PDF aus.
3. **In Google Drive:** Klicke mit der rechten Maustaste (Kontextmenü-Taste) auf die hochgeladene PDF.
4. Wähle **"Öffnen mit"** → **"Google Docs"** (Google Dokumente).
5. **Geduld:** Google Docs versucht jetzt, die PDF in Text umzuwandeln. Das kann einen Moment dauern. Es wird nicht perfekt sein, aber oft werden Tabellen erkannt.
6. **Jetzt hast du ein Google Doc** mit dem Inhalt der PDF. Oft ist die Tabelle als Tabelle erkennbar.
7. **Jetzt kannst du wie in Kapitel 3 vorgehen:** Entweder die Tabelle kopieren und in Excel einfügen, oder das Google Doc als Textdatei herunterladen und in Excel importieren .

### 5.3 Methode 3: Spezielle PDF-zu-Excel-Konverter

Wenn die PDF sehr kompliziert ist (z.B. eingescannte Rechnungen), brauchst du spezielle Programme. Es gibt kostenlose und kostenpflichtige:

- **Online-Konverter:** z.B. Smallpdf, PDFTables, iLovePDF. Einfach die PDF hochladen, und die Webseite wandelt sie um. **Achtung:** Bei vertraulichen Daten (Rechnungen, persönliche Infos) solltest du das nicht tun, weil die Daten auf fremden Servern landen.
- **Professionelle Programme:** z.B. Adobe Acrobat Pro (kostet Geld) kann PDFs sehr gut nach Excel exportieren.

---

## Kapitel 6: Daten aus CSV- oder Textdateien importieren

CSV-Dateien sind sehr häufig. Das sind einfache Textdateien, bei denen die Daten mit Kommas getrennt sind. Sie sehen so aus:

```
Name,Alter,Stadt
Max,34,Berlin
Anna,28,München
```

### 6.1 CSV in Excel öffnen (der einfache Weg)

1. **Doppelklicke einfach auf die CSV-Datei.** Wenn Excel installiert ist, öffnet es sich automatisch und zeigt die Daten an. Meistens klappt das wunderbar.
2. Falls nicht: Öffne Excel, gehe auf **"Datei"** → **"Öffnen"** und wähle die CSV-Datei aus.

### 6.2 Der bessere Weg: Importieren mit Kontrolle

Manchmal erkennt Excel das Trennzeichen nicht richtig (z.B. wenn Semikolons statt Kommas verwendet werden). Dann machst du es besser so:

1. **Öffne Excel** und ein leeres Blatt.
2. Gehe auf **"Daten"** → **"Aus Text/CSV"**.
3. **Wähle die Datei aus.**
4. **Jetzt öffnet sich ein Vorschaufenster.** Hier siehst du, wie Excel die Daten aufteilen würde. Unten kannst du das Trennzeichen ändern, wenn es falsch ist (z.B. von Komma auf Semikolon).
5. Wenn die Vorschau gut aussieht, klicke auf **"Laden"**.

---

## Kapitel 7: Live-Daten aus dem Internet – Immer aktuell (Power Query)

Das ist die Königsklasse. Du kannst Excel so einrichten, dass es sich automatisch aktualisiert, wenn sich die Daten im Internet ändern .

**Beispiel:** Du holst dir jeden Morgen die aktuellen Börsenkurse von einer Webseite. Mit Power Query musst du das nicht jeden Tag neu machen. Ein Klick auf "Aktualisieren" holt die neuen Daten.

### 7.1 Power Query (nur Windows)

Power Query ist ein mächtiges Werkzeug, das in Excel für Windows eingebaut ist.

1. **Gehe auf "Daten"** → **"Daten abrufen"** (Get Data) → **"Aus anderen Quellen"** → **"Aus Web"**.
2. **Gib die URL ein** und klicke OK.
3. Wähle die Tabelle aus und klicke **"Laden"**.
4. **Jetzt kommt der Clou:** Wenn du später die Daten aktualisieren willst, klicke einfach mit der rechten Maustaste auf die Tabelle in Excel und wähle **"Aktualisieren"** (Refresh). Oder gehe auf "Daten" → "Alle aktualisieren".
5. Du kannst sogar einstellen, dass Excel die Daten automatisch alle z.B. 60 Minuten aktualisiert (unter "Daten" → "Eigenschaften" → "Aktualisierung alle ... Minuten").

### 7.2 Für Google Sheets: Verknüpfung mit Excel

Wenn du eine **Google Tabelle** hast, die sich ständig ändert, und du diese Daten live in Excel haben willst, geht das nur mit einem Trick :

1. **In Google Sheets:** Gehe auf **"Datei"** → **"Teilen"** → **"Im Web veröffentlichen"**.
2. Wähle als Format **"Kommagetrennte Werte (.csv)"** aus.
3. **Klicke auf "Veröffentlichen"**. Es erscheint ein Link. **Achtung:** Jeder mit diesem Link kann die Daten sehen! Also nur für öffentliche Daten oder mit Vorsicht verwenden.
4. **Kopiere den Link.**
5. **In Excel:** Gehe auf "Daten" → "Aus Web" und füge den Link ein.
6. Jetzt hast du eine Live-Verbindung. Wenn du in Excel aktualisierst, werden die neuesten Daten aus der Google Tabelle geholt.

**Sicherheitshinweis:** Private Google Sheets sollten nicht so veröffentlicht werden. Für vertrauliche Daten brauchst du andere Lösungen (z.B. über Dienste wie Zapier, aber das ist für Fortgeschrittene) .

---

## Kapitel 8: Daten aus anderen Excel-Dateien zusammenführen

Oft hast du Daten in verschiedenen Excel-Dateien und willst sie in einer Tabelle zusammenführen.

### 8.1 Einfaches Kopieren

Die simpelste Methode: Öffne beide Dateien, markiere in der einen, kopiere (Strg + C), wechsle in die andere (Alt + Tab) und füge ein (Strg + V).

### 8.2 Daten aus anderen Blättern verknüpfen (Formeln)

Du kannst in einer Zelle auf eine Zelle in einer ANDEREN Excel-Datei verweisen. Das nennt sich **externer Bezug**.

1. Öffne beide Excel-Dateien.
2. In der Zieldatei (wo die Daten hinsollen) tippst du ein `=`.
3. **Wechsle zur Quelldatei** (Alt + Tab).
4. **Klicke auf die Zelle**, deren Wert du haben willst.
5. **Drücke Enter**. Excel wechselt zurück und zeigt den Wert an.
6. Die Formel sieht dann so aus: `='[Quelldatei.xlsx]Tabelle1'!$A$1`
7. Wenn sich der Wert in der Quelldatei ändert, kannst du in der Zieldatei auf "Daten" → "Alle aktualisieren" klicken, und der neue Wert wird geholt.

---

## Kapitel 9: Die häufigsten Probleme und wie du sie löst

### 9.1 "Die Zahlen werden als Text importiert und ich kann nicht rechnen!"

**Symptom:** Die Zahlen stehen links in der Zelle (statt rechts) und Summen-Formeln funktionieren nicht.

**Lösung:**
- Markiere die Zellen.
- Es erscheint ein kleines gelbes Ausrufezeichen (Fehlerprüfung). Klicke drauf und wähle **"In Zahl konvertieren"**.
- Oder: Verwende die Funktion `=WERT(Zelle)` in einer neuen Spalte.

### 9.2 "Die Daten sind in einer einzigen Spalte, sollen aber auf mehrere verteilt sein!"

**Lösung:** **"Text in Spalten"** (siehe Kapitel 3.2).

### 9.3 "Überall sind unsichtbare Leerzeichen!"

Manchmal haben importierte Daten Leerzeichen vor oder nach dem Text, z.B. " Berlin " statt "Berlin". Das macht Suchen und Sortieren kaputt.

**Lösung:** Verwende die Funktion `=GLÄTTEN(Zelle)`. Die entfernt überflüssige Leerzeichen .

### 9.4 "Excel zeigt ### in der Zelle an"

Keine Panik! Die Spalte ist nur zu schmal. Mach sie breiter (doppelklick zwischen den Spaltenköpfen).

### 9.5 "Die Daten aus dem Internet werden nicht richtig angezeigt"

- Vielleicht ist die Webseite nicht für automatisches Auslesen gemacht.
- Versuche es mit einfachem Kopieren und Einfügen.
- Manchmal hilft es, die Webseite als HTML zu speichern und dann in Excel zu importieren.

---

## Kapitel 10: Deine Übung – Probier es selbst!

Jetzt bist du dran. Hier ist eine kleine Übung, mit der du alles Gelernte ausprobieren kannst.

1. **Öffne Google Docs** und erstelle eine kleine Tabelle:
   - Spalte 1: "Obst"
   - Spalte 2: "Preis pro Kilo"
   - Spalte 3: "Lieblingsfarbe"
   - Trage 3-4 Zeilen ein (z.B. Äpfel, Birnen, Bananen).

2. **Kopiere die Tabelle** und füge sie in Excel ein (Strg+C, Strg+V).

3. **Suche im Internet** nach einer kleinen Tabelle, z.B. die aktuelle Wettervorhersage für deine Stadt auf einer Wetter-Webseite. Versuche, sie zu kopieren und in Excel einzufügen.

4. **Erstelle in Google Sheets** eine kleine Tabelle (z.B. deine Ausgaben für eine Woche). Lade sie als Excel-Datei herunter (Datei → Herunterladen → Microsoft Excel).

5. **Öffne die heruntergeladene Datei** in Excel.

**Geschafft!** Du hast Daten aus drei verschiedenen Quellen nach Excel gebracht.

---

## Kapitel 11: Zusammenfassung – Welcher Weg für welche Situation?

| Wenn du Daten hast... | Dann nimm... |
|-----------------------|--------------|
| In einer **Webseiten-Tabelle** | Einfach: Kopieren + Einfügen. Für Profis: "Aus Web" in Excel (Windows) |
| In **Google Docs als Tabelle** | Kopieren + Einfügen |
| In **Google Docs als Liste** | Kopieren → in Excel → "Text in Spalten" |
| In **Google Sheets** | Herunterladen als Excel-Datei |
| In **einer PDF** | Erst kopieren probieren, sonst Umweg über Google Drive |
| Als **CSV-Datei** | Doppelklick oder "Daten" → "Aus Text/CSV" |
| Auf einer **Webseite, die sich oft ändert** | Power Query ("Aus Web") mit Aktualisierung |

---

## Abschluss: Du bist jetzt ein Daten-Profi!

Herzlichen Glückwunsch! Du hast gelernt, wie man Daten aus allen möglichen Quellen nach Excel bekommt. Das ist eine der wertvollsten Fähigkeiten überhaupt, denn Daten sind überall – und jetzt weißt du, wie du sie einfängst.

- Du kannst Tabellen aus Webseiten kopieren.
- Du kannst Listen aus Google Docs sauber in Spalten aufteilen.
- Du kannst Google Sheets in Excel umwandeln.
- Du kannst sogar PDFs knacken.
- Und du weißt, wie man Probleme löst, wenn mal was nicht klappt.

**Denk immer daran:** Daten sind wie Wasser – sie fließen überall. Und Excel ist dein Eimer, mit dem du sie auffängst und nutzbar machst.

Im nächsten Telekolleg könnten wir uns anschauen, wie man aus diesen Daten dann Diagramme macht oder wie man mit Pivot-Tabellen riesige Datenmengen analysiert. Aber für heute reicht das völlig.

**Du hast Großartiges geleistet!**

---

*P.S.: Wenn etwas unklar war oder du einen Schritt nicht verstanden hast – frag einfach. Dafür ist dieses Telekolleg da.*