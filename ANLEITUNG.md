# Schuldenbuch – online stellen & aufs iPhone bringen

Die App besteht nur aus Dateien. Damit dein iPhone sie laden kann, müssen sie einmal
im Internet liegen. Das geht kostenlos mit **GitHub Pages**. Deine **Schulden-Daten
landen dabei nie im Internet** – sie bleiben nur auf deinem iPhone.

---

## Teil 1: GitHub-Konto anlegen (einmalig, ca. 5 Minuten)

1. Öffne am PC **https://github.com** und klicke auf **Sign up**.
2. Gib deine E-Mail-Adresse ein, wähle ein Passwort und einen **Benutzernamen**
   (z. B. `josch-apps`). Merk ihn dir – er wird Teil der App-Adresse.
3. Löse das kleine Rätsel und bestätige den Code, den GitHub dir per E-Mail schickt.
4. Fragen nach Team/Interessen kannst du überspringen. Wähle den kostenlosen Plan (**Free**).

## Teil 2: Repository (Projektordner) anlegen

1. Klicke oben rechts auf **+** → **New repository**.
2. **Repository name:** `schuldenbuch`
3. Wähle **Public** (GitHub Pages ist im kostenlosen Plan nur für öffentliche Projekte verfügbar.
   Öffentlich ist nur der *Programmcode*, nicht deine Daten).
4. Klicke auf **Create repository**.

## Teil 3: Dateien hochladen

1. Auf der neuen, fast leeren Seite klickst du auf den Link **uploading an existing file**.
2. Öffne im Windows-Explorer den Ordner `claude schulden` und ziehe **diese** Dateien und Ordner
   in das Browserfenster:
   - `index.html`
   - `manifest.json`
   - `sw.js`
   - Ordner `css`
   - Ordner `js`
   - Ordner `icons`

   (Nicht nötig: `lokal-testen.ps1`, `ANLEITUNG.md` und der Ordner `.claude` – schaden aber auch nicht.)
3. Warte, bis alle Dateien in der Liste erscheinen, und klicke unten auf **Commit changes**.
4. Prüfe: In der Dateiliste müssen `index.html`, `css`, `js`, `icons` usw. direkt sichtbar sein
   (nicht in einem Unterordner „claude schulden“).

## Teil 4: GitHub Pages einschalten

1. Im Repository oben auf **Settings** (Zahnrad) klicken.
2. Links im Menü **Pages** wählen.
3. Unter **Build and deployment** → **Source**: **Deploy from a branch**.
4. Unter **Branch**: `main` und Ordner `/ (root)` auswählen → **Save**.
5. 1–2 Minuten warten und die Seite neu laden. Oben erscheint:
   **„Your site is live at https://DEIN-NAME.github.io/schuldenbuch/“**
6. Öffne die Adresse zur Kontrolle am PC – die App sollte erscheinen.

## Teil 5: Auf dem iPhone installieren

1. Öffne auf dem iPhone **Safari** (wichtig: wirklich Safari, nicht Chrome o. Ä.).
2. Gib die Adresse ein: `https://DEIN-NAME.github.io/schuldenbuch/`
3. Tippe auf das **Teilen-Symbol** (Quadrat mit Pfeil nach oben).
   Bei neueren iOS-Versionen musst du dafür eventuell erst auf **•••** tippen.
4. Scrolle im Menü nach unten und tippe auf **„Zum Home-Bildschirm“**.
5. Falls ein Schalter **„Als Web-App öffnen“** angezeigt wird: eingeschaltet lassen.
6. Name „Schuldenbuch“ lassen → **Hinzufügen**.
7. Öffne die App **einmal vom Home-Bildschirm aus, solange du Internet hast**.
   Dabei speichert sie sich komplett aufs Handy.
8. Test: Flugmodus an → App öffnen → sie funktioniert trotzdem. ✈️

## Wichtig zu wissen

- **Daten gehören zur Home-Bildschirm-App.** Was du im normalen Safari-Tab einträgst,
  ist *nicht* in der installierten App (und umgekehrt). Benutze also immer das App-Icon.
- **Löschst du das App-Icon**, sind auch die Daten weg. Es gibt kein Backup.
- Die Daten verlassen nie dein iPhone – kein Server, kein Login.

## Später etwas ändern?

1. Datei(en) am PC ändern und mit `lokal-testen.ps1` testen (siehe unten).
2. Auf GitHub im Repository wieder **Add file → Upload files** und die geänderten Dateien
   hochladen (gleicher Name = wird überschrieben) → **Commit changes**.
3. 1–2 Minuten warten. Dann die App auf dem iPhone **zweimal** öffnen (komplett schließen
   dazwischen): Beim ersten Öffnen lädt sie das Update im Hintergrund, beim zweiten ist es aktiv.
4. Hast du Dateien **hinzugefügt oder umbenannt**, trage sie in `sw.js` in die Liste `FILES`
   ein und erhöhe dort die Versionsnummer (`schuldenbuch-v1` → `schuldenbuch-v2`).

## Lokal am PC testen

Rechtsklick auf `lokal-testen.ps1` → **Mit PowerShell ausführen**, dann im Browser
**http://localhost:8080** öffnen. Tipp: In Chrome/Edge mit `F12` und dem Handy-Symbol
die iPhone-Ansicht simulieren.
