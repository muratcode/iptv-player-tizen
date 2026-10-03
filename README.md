<div align="center">

# IPTV Player

**A free, ad-free, open-source IPTV player for Samsung Smart TVs (Tizen OS)**

Xtream Codes and M3U support · Hardware video playback (AVPlay) · Fully remote-driven interface

![Platform](https://img.shields.io/badge/platform-Samsung%20Tizen%20TV-1428A0)
![Target](https://img.shields.io/badge/target-Tizen%209.0-0A7EA4)
![JavaScript](https://img.shields.io/badge/JavaScript-ES5-F7DF1E)
![Dependencies](https://img.shields.io/badge/runtime%20dependencies-none-brightgreen)
![Ads](https://img.shields.io/badge/ads-none-brightgreen)

**English** · [Türkçe](README.tr.md)

</div>

---

> [!IMPORTANT]
> This app **does not provide any channels or content.** It only plays IPTV streams that the
> user is legally entitled to access. The code contains no real server addresses or account
> details; all examples use placeholders such as `http://SERVER:PORT`, `USERNAME` and
> `PASSWORD`. Legal responsibility for the content lies with the user.

Written for Samsung's **Tizen OS**, not Android TV. It uses no framework: plain HTML5, CSS3
and ES5 JavaScript. No license, activation, account or telemetry.

> [!NOTE]
> The app's user interface is in **Turkish**. This document gives on-screen labels in English
> with the Turkish label exactly as it appears on screen in parentheses, e.g. *Settings*
> (*Ayarlar*), so you can find them on the TV.

## Contents

- [Recent updates](#recent-updates)
- [Features](#features)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Remote control keys](#remote-control-keys)
- [Architecture](#architecture)
- [Performance design](#performance-design)
- [Samsung / Tizen APIs used](#samsung--tizen-apis-used)
- [Error handling](#error-handling)
- [Online subtitles (OpenSubtitles)](#online-subtitles-opensubtitles)
- [Data storage and privacy](#data-storage-and-privacy)
- [Tests](#tests)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

---

## Recent updates

**New: the app player — files like Friends can now be seeked**
- **Unseekable MKV files like Friends can now be seeked.** In some MKV files the seek index
  (Cues) is not referenced directly from the start of the file; Samsung's player rejects
  every seek in these files and the picture gets stuck (measured on a real TV). Before
  playback the app reads the first 8 KB of the file and opens such a file with **its own
  player**: it reads the file itself, finds the seek index at the end, converts the frames to
  MP4 fragments and feeds them to the browser's Media Source player. Seeking, resume, audio
  track selection and the subtitles embedded in the file all work.
- **Settings → Movie/Series Player** (*Film/Dizi Oynaticisi*): choosing *App player*
  (*Uygulama oynaticisi*) uses this player for every MKV movie and series. While playing,
  Samsung's player jumps to the nearest keyframe, so a 10 s seek could become 8–12 s
  (measured on the TV); the app player lands exactly on the requested second (±0.04 s) and
  short seeks are served instantly from memory.
- **A 10 s seek is now exactly 10 s:** seeks are calculated from the player's live position
  instead of the position report that arrives every half second (with both players).
- **"Start over" (*Bastan oynat*) really starts from the beginning now.** With *Resume*
  (*Kaldigi Yerden Devam*) enabled, it used to seek to the saved position as well.
- The info bar shows the file type (MKV, MP4, AVI…), which helps when reporting problems.

**Enter your account once — `hesaplar.txt`**
- Paste your link once into `hesaplar.txt` ("accounts") in the project folder on your computer.
  The file goes into every build; on a fresh install the app adds the account by itself and
  the login screen never appears. Details: [hesaplar.txt](#enter-your-account-once-hesaplartxt).
- Add an `opensubtitles | API_KEY` line to the same file and the subtitle service is set up
  automatically on every install as well.
- On startup a notification reports what was imported ("account added, subtitle service
  configured"); the login screen also reminds you of this feature.

**Fast-forward / rewind freeze fixed**
- The app ignored the fact (documented by Samsung) that AVPlay accepts no other command while
  `seekTo` is running: repeated seeks, pausing during a seek or reading the track list froze
  the picture. Commands that arrive during a seek are now queued and applied once it finishes.
- Repeated seek presses and the ⏪ ⏩ keys accumulate into **a single seek**.
- A seek continues from the **target** of the seek in progress (it used to be calculated from
  the old position and could jump backwards).
- Buffering values were raised to Samsung's minimum (4 s); less stalling after a seek.
- When the stream is restarted after a network drop, movies/episodes **resume where they
  left off**.
- Short waits after a seek show a small indicator instead of a full-screen box.
- If a seek fails, never answers or freezes the picture afterwards, the stream reopens by
  itself **from the last position that was actually played**. The seek target used to be
  saved instead; after seeking to a broken point, the episode seeked there again on every
  open and froze again, and only starting from the beginning helped. If seeking does not
  work at all for a file, the screen says so clearly.

**Design fixes**
- The selected poster in the series/movie grid **no longer jumps up and down**: exactly two
  rows fit on screen, the selected row always stays in the same place, and the number of
  columns is calculated from the screen width.
- The poster focus frame is drawn **on top of** the image (it used to be hidden behind it).
- Scrolling down the subtitle selection list no longer makes the list **jump up**; long lists
  show a "7 / 20" counter.
- On-screen subtitles slide up smoothly when the info bar opens instead of jumping.
- Column headers no longer overlap the first row; the bottom hint bar no longer covers content.
- In Settings the list no longer covers the right-hand panel and no longer jumps when you
  change a setting.
- The Login and Subtitle Service screens use a two-column card and fit a 1080p screen.
- The category search box moved into the column header, leaving more room for posters.
- In the player, notifications no longer cover the "Skip Intro" / "Next episode" cards.

**Other fixes**
- In Live TV the RED (refresh) key threw an error and ignored the search filter.
- When a live stream cannot be paused, the screen no longer wrongly says "Paused"; the user
  is told clearly instead.
- When zapping quickly, a late result from the previous channel no longer breaks the new one.

---

## Features

### Login and playlist management

- **Xtream Codes API** — server URL + username + password
- **M3U / M3U8** — direct playlist URL (+ optional XMLTV EPG URL)
- **`hesaplar.txt`** — write your link (and optionally your OpenSubtitles key) once on your
  computer; the account and subtitle service are set up automatically in every build
- Save **multiple playlists** and switch with one key (*My Playlists* / *Playlistlerim* screen)
- A **QR code** for each playlist — transfer it to your phone or another device
- **Back up to / restore from USB** — so data is not lost when the app is reinstalled
- Password hidden by default, revealed with "Show password" (*Sifreyi goster*)

### Content

- **Live TV** — categories, channels, logos, channel numbers, EPG (now / next)
- **Movies (VOD)** — categories, posters, details (plot, duration, cast, rating)
- **Series** — categories, seasons, episodes, episode summaries
- **Automatic series detection in M3U** — patterns such as `Show Name S01 E05`, `1x05`,
  `Season 1 Episode 5` and `Sezon 1 Bölüm 5` are recognized; episodes are grouped into
  series and do not clutter the Movies section
- **Category order is preserved** — the provider's order in the playlist is kept
  (Turkish channels are almost always at the top; alphabetical sorting would break that)
- Favorites (channel / movie / series / episode)
- Recently watched + **resume where you left off**
- Search within a category and global search (ignores Turkish diacritics: "guclu" ↔ "güçlü")
- Account info: status, **expiry date**, days left, number of concurrent connections

### Player

- Samsung **AVPlay** (`webapis.avplay`) hardware player; HLS `.m3u8`, MPEG-TS `.ts`, MP4, MKV
- **App player (MKV)** — the app's own MKV player built on Media Source; used automatically
  for files the TV cannot seek, and optionally (Settings → Movie/Series Player) for every MKV
  movie and series. Seeks land exactly on the requested second
- If one format fails, it **automatically tries the other** (`.m3u8` ↔ `.ts`)
- **Accelerating seek** — the step grows the more you press
  (10 s → 30 s → 1 min → 2 min → 5 min) and jumps once when you release the key
- **Freeze-free seeking** — AVPlay accepts no other command during a seek; seeks, pauses and
  track selections that arrive meanwhile are queued, intermediate targets are skipped and
  only the last one is applied
- After a network drop, or when restarting with the BLUE key, movies/episodes **resume where
  they left off**
- **Automatic next episode** — a countdown card in the final seconds;
  if the season changes it asks instead of switching automatically
- **Skip intro** suggestion (with OK)
- Multiple **audio** and **subtitle** tracks — the selected track is marked with ✔,
  language codes are shown as names (`tur` → Türkçe)
- **Subtitles are drawn by the app** (AVPlay does not render them itself), with a thick
  outline that is readable on a TV; they slide up smoothly when the info bar opens
- **The chosen audio/subtitle language is remembered** and applied automatically to later
  content (the language code is stored, not the index, because the index differs per file)
- **Subtitle download from the internet** (OpenSubtitles) — [details below](#online-subtitles-opensubtitles)
- Quick switching by channel number, 4K mode, aspect ratio selection
- On errors: a message + **Retry / Next Channel / Go Back**

### Interface

- Dark theme, high contrast, large fonts readable from 3–4 meters
- Clear focus indicator — it is always obvious which item is selected; on posters the frame
  is drawn on top of the image, and focused text does not turn bold or shift
- **Fixed focus** — in the poster grid the selected row always stays in the same place and
  the content scrolls beneath it; exactly two rows fit on screen, and the number of columns
  is calculated from the screen width
- Scrolling in lists snaps to row boundaries (no half-cut row at the top)
- The frame of the active column panel is subtly highlighted
- The in-category search box sits to the right of the column header (it takes no extra row)
- Long selection lists (e.g. subtitle results) show a "7 / 20" position counter
- In the player, notifications appear in the top-right corner and do not cover the
  "Skip Intro" / "Next episode" cards at the bottom
- The Login and Subtitle Service screens use a two-column card that fits a 1080p screen
- **No mouse/touch** — fully remote-driven
- Same look at 1080p and 4K (all sizes in `rem`, `html { font-size: 100vw/120 }`)
- Overscan safe area
- Optional **splash image** — its duration is set in Settings, any key skips it

---

## Quick start

### Requirements

| Requirement | Description |
|---|---|
| Samsung TV | Targets Tizen 9.0 (2025 models) |
| Development computer | Windows 10/11 (for the Tizen tools) |
| Tizen tools | Tizen Studio + TV Extension **or** the VS Code Tizen extension |
| Samsung account | Free; needed to create a certificate |
| Network | The PC and the TV must be on the **same local network** |

For a step-by-step setup from scratch (Tizen Studio, Developer Mode, certificate, installing
on the TV), see **[KURULUM.md](KURULUM.md)** (in Turkish).

### Image files (not in the repository)

The app icon and splash image are **not included** in the repository. Add your own images
before building the project:

| File | Size | Required? | What happens if missing? |
|---|---|---|---|
| `icon.png` | 512×512 PNG | **Yes** — used by `config.xml` | The package does not build or the TV shows a default icon |
| `assets/icon.png` | 128×128 PNG | No | The login screen shows a ▶ logo |
| `assets/splash.jpg` | 1920×1080 JPEG | No | The splash is skipped and the app opens directly |

### Try it on a PC first (no TV needed)

```cmd
python -m http.server 8080
```

Then open `http://localhost:8080` in Chrome. Since `webapis.avplay` is not available, the app
automatically switches to HTML5 `<video>` mode.

- **Keyboard mapping:** arrow keys = directions, **Enter** = OK, **Backspace** = RETURN
- Chrome cannot play MPEG-TS and only Safari supports HLS natively, so **no picture on a PC is
  normal.** Lists, navigation, search, favorites, settings and error handling can all be
  tested fully.
- If the folder contains a filled-in `hesaplar.txt`, the account is added automatically in the
  browser too and the login screen is skipped. To try the login screen, delete the account in
  the app (*My Playlists* → RED); it is not re-added in the same browser.

### Installing on the TV (summary)

1. Turn on **Developer Mode** on the TV (type `1 2 3 4 5` on the Apps screen) and enter the
   PC's IP address.
2. Create a certificate (Samsung certificate; Distributor certificate bound to the TV's DUID).
3. Connect to the TV, then build, sign and install:

```cmd
sdb connect <TV_IP>:26101

tizen build-web -e tests -e _kaynak -e node_modules -e "*.md" -- .
tizen package -t wgt -s <CERTIFICATE_PROFILE> -- .buildResult
tizen install -n IPTVPlayer.wgt -- .buildResult -t <TV_IP>:26101
tizen run -p IptvPlyr01.IPTVPlayer -t <TV_IP>:26101
```

> **Do not exclude** `hesaplar.txt` (do not add it to the `-e` list); the account arriving
> automatically on every install depends on this file being in the package.

> **Using VS Code:** the Tizen extension's `Tizen: Build Project` and `Tizen: Run Project`
> commands do the same job. The extension does not exclude the `tests/` and `_kaynak/`
> folders by itself; add `tests/*` and `_kaynak/*` to the `excludes` list in
> `tizen_web_project.yaml`.

> **Reinstalling wipes the app's data.** Use
> [`hesaplar.txt`](#enter-your-account-once-hesaplartxt) to keep your account. For favorites
> and history, make a backup with **Settings → Back up to USB** (*Ayarlar → USB'ye Yedekle*)
> before installing the new version, then choose **Settings → Restore from backup**
> (*Ayarlar → Yedekten Geri Yukle*) after installing.

### Enter your account once: `hesaplar.txt`

Instead of typing a long playlist link with the remote, paste it **once** into `hesaplar.txt`
in the project folder on your computer. The file goes into the package on every build; at
startup the app reads it, adds any account that is not yet saved and activates it. The home
screen opens without the login screen ever appearing.

```text
# One account per line; lines starting with # are comments
http://SERVER:PORT/get.php?username=USERNAME&password=PASSWORD&type=m3u_plus
Home | http://SERVER:PORT/get.php?username=USERNAME&password=PASSWORD
Work | http://SERVER:PORT | USERNAME | PASSWORD
m3u | List | http://SERVER:PORT/list.m3u8

# Subtitle service (optional) — username/password and language are not required
opensubtitles | API_KEY | USERNAME | PASSWORD | dil=en
```

- `get.php?username=...&password=...` links are converted automatically into an
  **Xtream Codes** account (movies, series and the guide work better that way). If you want
  a plain M3U list, start the line with `m3u |`.
- The `opensubtitles |` line saves your OpenSubtitles API key (and account, if given) on
  every install; you never have to open *Settings → Subtitle Service* (*Altyazi Servisi*)
  again. `dil=` means "language"; without it, subtitles are searched in Turkish (`dil=tr`).
  The keyword `altyazi` ("subtitle") works in place of `opensubtitles`.
- The file is read on every startup. If you change the password of a saved Xtream account in
  the file, the saved account is updated on the next startup (no duplicate is created).
- An account you delete in the app is not re-added within the same install; it comes back
  when a new build is installed. If you change the subtitle settings on the TV by hand, the
  TV setting is kept until you change the line in the file. Removing the line does not delete
  the saved setting.
- Lines that cannot be understood are skipped (a warning is logged); the other lines are still
  processed.
- The file contains your password: it is in `.gitignore`, but it **does go into the .wgt
  package** — do not share the package.
- If the file is missing or empty, the app opens normally with the login screen.

---

## Usage

1. On the **login screen**, choose the playlist type:
   - **Xtream Codes:** `http://SERVER:PORT`, username, password
   - **M3U:** playlist URL (+ optional XMLTV EPG URL)

   If you would rather not type a long link with the remote, put it in
   [`hesaplar.txt`](#enter-your-account-once-hesaplartxt) before building; the login screen
   will never open.
2. The playlist is saved; on later starts you pick it from the *My Playlists* screen.
3. From the home screen, go to Live TV, Movies, Series, Favorites, Recently Watched, Search
   and Settings.

> **Series only work fully with Xtream Codes** sources. M3U has no season/episode structure;
> the app tries to detect it automatically and tells the user clearly.

---

## Remote control keys

### General

| Key | Action |
|---|---|
| ◀ ▶ ▲ ▼ | Navigate |
| OK / Enter | Select / open |
| RETURN (Back) | Back |
| EXIT | Exit confirmation |

**BACK key behavior:**

```
player  →  list  →  home menu  →  "Exit?" confirmation  →  exit
```

On-screen states are undone first: in the player an open info bar closes first; in Live TV,
if you are in the channel column you return to the category column first; on the series
detail screen, if you are in the episode list you return to the season row first; while
editing text, the TV keyboard closes.

### Live TV

| Key | Action |
|---|---|
| YELLOW | Add to / remove from favorites |
| BLUE | Jump to the favorites category |
| RED | Refresh the channel list |
| 0–9 | Quick switch by channel number |
| CH+ / CH− | Page jump |
| ▲ (at the top of the list) | Move to the in-category search box in the header |

### Player

| Key | Action |
|---|---|
| OK | In order: **next episode** → **skip intro** → **pause / resume** |
| INFO | Show/hide the info bar |
| ▲ ▼ / CH+ CH− | Change channel (live) |
| ◀ ▶ | Rewind / fast-forward — speeds up as you keep pressing |
| ⏪ ⏩ | 1 min back / forward — repeated presses accumulate into a single seek |
| PLAY / PAUSE | Pause / resume (if a live stream does not support it, this is shown on screen) |
| RED | Favorite |
| GREEN | Choose audio track |
| YELLOW | Choose subtitles |
| BLUE | Restart the stream (when frozen; movies/episodes resume where they left off) |
| 0–9 | Channel number |

### Other screens

| Screen | Key | Action |
|---|---|---|
| Home | RED | Refresh content |
| Home | YELLOW | Search |
| Movies / Series | OK | Movie details and playback options / the series' seasons and episodes |
| Movies / Series | YELLOW | Add to / remove from favorites |
| Movies / Series | ▲ (at the top of the grid) | Move to the in-category search box in the header |
| Series detail | CH+ / CH− | Previous / next season |
| Series detail | YELLOW | Add episode to / remove from favorites |
| Favorites | YELLOW | Remove from favorites |
| Favorites | BLUE | Clear all favorites |
| Recently Watched | YELLOW | Delete entry |
| Recently Watched | BLUE | Clear history |
| My Playlists | GREEN | Add a new playlist |
| My Playlists | YELLOW | Edit |
| My Playlists | RED | Delete |
| Search (in the results list) | YELLOW | Add to / remove from favorites |
| Login | RED / GREEN | Switch to the Xtream Codes / M3U tab |

---

## Architecture

```
        views/*  (screens — presentation and remote input only)
           │
           ▼
    services/content.js   ◄── FACADE
           │
     ┌─────┴─────┐
     ▼           ▼
 xtream.js    m3u.js  ──►  epg.js
     │           │
     ▼           ▼
  core/http.js  core/cache.js  core/storage.js
     │
     ▼
 player/controller.js ──► avplay.js  |  html5.js  |  mse.js (+ mkv.js, fmp4.js)
```

**Rule:** each layer only knows the layer **below** it. Nowhere in `views/` is `App.Xtream`
called directly; everything goes through `App.Content`. Adding a new source type only
requires extending `content.js`.

**Startup order:** `js/app.js` first reads `hesaplar.txt` through `services/presets.js`
(accounts go to `services/profile.js`, subtitle settings to `services/opensubtitles.js`),
then opens the home screen if there is an active account, or the login screen otherwise.

**Player layer:** `player/controller.js` handles all seeks from a single place
(`engineSeek`) and ignores stale positions reported by AVPlay while a seek is running.
`player/avplay.js` holds the lock that guarantees no other call is made while AVPlay's
asynchronous operations (`prepareAsync`, `seekTo`) are running: pause/resume, track
selection and display settings that arrive meanwhile are applied when the operation finishes.

**App player:** MKV files whose seek index the TV cannot read (detected before playback by
`player/seekcheck.js`), and every MKV when *App player* is selected in Settings, are played
by `player/mse.js`: `player/mkv.js` parses the file piece by piece, `player/fmp4.js` turns the
frames into MP4 fragments, and `<video id="mse-player">` plays them through Media Source.
The engine is chosen on every open; if the app player cannot open a file, that file is
opened with AVPlay. Requests are never made in parallel (the account may allow a single
connection), and the buffer is sized from the file's bit rate (~40 MB).

### Folder structure

```
iptv-app/
├── config.xml                 Tizen manifest: privileges, CSP, settings
├── tizen_web_project.yaml     VS Code Tizen extension project settings
├── index.html                 Single page; script load order lives here
├── icon.png                   App icon (not in the repo, see above)
├── hesaplar.txt               Personal account links + subtitle key; goes into every build (not in the repo)
├── README.md                  This document (English)
├── README.tr.md               Turkish version of this document
├── KURULUM.md                 Tizen Studio + TV installation guide (Turkish)
│
├── css/
│   ├── theme.css              Color/size tokens, typography, safe area
│   ├── reset.css              Simplified reset for TV (cursor:none)
│   ├── layout.css             App skeleton, 3-column layout, top bar
│   ├── components.css         Button, field, list, poster, modal, toast
│   └── views.css              Screen-specific layouts
│
├── js/
│   ├── app.js                 Bootstrapper: key router, lifecycle
│   ├── core/
│   │   ├── polyfill.js        ES5/ES6 gaps for old Tizen browsers
│   │   ├── utils.js           DOM, text, date, URL and chunked-loop helpers
│   │   ├── logger.js          Tagged logging + level control
│   │   ├── errors.js          App.AppError — typed error + user message
│   │   ├── events.js          Global event bus (App.Bus)
│   │   ├── storage.js         localStorage wrapper + password obfuscation
│   │   ├── settings.js        User preferences
│   │   ├── cache.js           Two-tier (memory + disk) TTL cache
│   │   ├── bigstore.js        IndexedDB store for large data (playlist blob)
│   │   ├── http.js            XHR client: timeout, retry, typed errors
│   │   ├── keys.js            Samsung remote key codes + registerKey()
│   │   ├── nav.js             Geometric focus management (spatial navigation)
│   │   ├── router.js          Screen stack + BACK key behavior
│   │   └── actions.js         Shared "open content" logic
│   └── ui/
│       ├── loading.js         Full-screen loading indicator
│       ├── toast.js           Short notifications
│       ├── modal.js           Confirm / alert / choice dialogs
│       ├── field.js           Text input with the TV keyboard (IME)
│       ├── imageLoader.js     Queued logo/poster loader with limited concurrency
│       ├── virtualList.js     Virtual list/grid — the heart of performance
│       └── qrcode.js          Pure ES5 QR encoder (no external dependency)
│
├── services/
│   ├── profile.js             Saved playlists + active account
│   ├── xtream.js              Xtream Codes API client + URL generation
│   ├── m3u.js                 M3U/M3U8 parser (chunked, never blocks the UI)
│   ├── epg.js                 Xtream short_epg + streaming XMLTV parser
│   ├── content.js             FACADE: views don't know the source type
│   ├── favorites.js           Favorites
│   ├── history.js             Recently watched + resume position
│   ├── backup.js              Back up & restore to USB/internal storage
│   ├── presets.js             hesaplar.txt: sets up accounts and the subtitle service at startup
│   ├── subtitles.js           SRT/VTT parser + timeline
│   └── opensubtitles.js       OpenSubtitles REST API client
│
├── player/
│   ├── avplay.js              webapis.avplay wrapper
│   ├── html5.js               <video> fallback for PC browsers
│   ├── seekcheck.js           Tells, before playback, whether the TV can seek in an MKV file
│   ├── mkv.js                 Matroska (MKV) parser: tracks, seek index, frames
│   ├── fmp4.js                Fragmented MP4 writer (H.264/H.265, E-AC-3/AC-3/AAC)
│   ├── mse.js                 MKV player built on Media Source (the "app player")
│   └── controller.js          Session management: recovery, zapping, position saving
│
├── views/                     login, playlists, home, live, movies, series,
│                              seriesDetail, favorites, recent, search, settings,
│                              opensubtitles, player
│
├── assets/                    icon.png, splash.jpg (not in the repo, see above)
└── tests/                     jsdom-based automated tests
```

### Why ES5?

The code is deliberately written in **ES5** syntax (`var`, `function`; no template literals,
`class` or `async/await`). The reason is the engine difference between Tizen versions:

| Tizen | Year | Browser engine |
|---|---|---|
| 2.3 | 2015 models | Chromium 34 |
| 2.4 | 2016 models | Chromium 47 — no `async/await` or destructuring |
| 9.0 | 2025 models | Modern Chromium |

Writing ES5 costs nothing, but it increases the chance that the app runs on both old and new
Samsung TVs. `Promise` is used (supported since Tizen 2.3), with a small polyfill as a
safety net.

---

## Performance design

An IPTV playlist can have 10,000+ channels. A naive app opens that on a TV with a 20-second
freeze. This project takes the following measures:

**1. Virtual list** (`js/ui/virtualList.js`) — only as many DOM elements as there are visible
rows (+ a buffer) are created, and they are **reused** while scrolling. Scrolling uses
`transform: translateY()` instead of `scrollTop` (GPU-accelerated, no reflow).

> Measurement (jsdom, 20,000 items): **15 DOM nodes, 15 renders, 2 ms**

**2. TTL cache + compact M3U encoding** (`js/core/cache.js`, `services/m3u.js`) —
categories are cached for 6 hours, channel lists for 30 minutes, EPG for 2 minutes and the
parsed M3U playlist for 1 week. Each item becomes an array and each category name an index;
the **common prefix** of the URL and logo fields is stored once (in a real Xtream M3U, all
20,000 channels start with the same 77-character prefix).

> Measurement (realistic 5,000-channel playlist): **1,985 KB → 298 KB (15%)**, about 6.7× smaller

**3. IndexedDB storage** (`js/core/bigstore.js`) — on Samsung TVs the `localStorage` quota is
~5 MB and all app data shares it. When a large playlist did not fit, the write failed
silently and the list was downloaded again on every start. The playlist blob is now written
to IndexedDB; if IndexedDB is unavailable, it silently falls back to `localStorage`.

**4. Removing forced synchronous layout** — `U.rem()` called `getComputedStyle()` on every
row render, which caused visible stutter while scrolling. The value is now cached. List rows
are not rebuilt: the DOM skeleton is built once per pool element, and scrolling only updates
text/images (`create` + `update`). The focus ring appears instantly instead of animating
`box-shadow`.

**5. Chunked parsing** (`U.chunked`) — 100,000-line M3U and 50 MB XMLTV files are processed in
chunks of 2,000 with `setTimeout(0)` between chunks. The UI never locks up and the user sees
a percentage. XMLTV is **not parsed with DOMParser** (the DOM tree of a 50 MB XML file needs
~500 MB of RAM); a regex-based streaming parser is used instead, and only programmes in the
"now −2 hours / +36 hours" window are kept.

**6. Scroll modes** (`js/ui/virtualList.js`) — lists with short rows (channels, categories)
scroll in `edge` mode: they scroll when focus reaches the edge, the one-row look-ahead is
limited to what fits in the visible area, and scrolling snaps to row boundaries. Poster grids
use `anchor` mode: the focused row always stays at the top. When a list is refreshed
(`setItems(..., { keepScroll: true })`), the scroll position is kept.

**7. Nothing is written to invisible elements** — the player reports its position every
~0.5 s; while the info bar is closed the progress bar is not updated, and when the bar opens
it is drawn once with the latest value. Moving the subtitles uses a `transform` transition
(GPU).

> ES5 was not the cause of the stutter. There is no runtime speed difference between ES5 and
> ES6; both are compiled by the same JIT.

---

## Samsung / Tizen APIs used

| API | Where | What for |
|---|---|---|
| `webapis.avplay.open / prepareAsync / play` | `player/avplay.js` | Hardware video playback |
| `webapis.avplay.setDisplayRect` | `player/avplay.js` | Position of the video plane on screen |
| `webapis.avplay.setDisplayMethod` | `player/avplay.js` | Aspect ratio (letterbox / fill) |
| `setStreamingProperty('SET_MODE_4K')` | `player/avplay.js` | 4K hardware path (2020+ models) |
| `setStreamingProperty('ADAPTIVE_INFO')` | `player/avplay.js` | HLS starting bitrate → faster channel start |
| `webapis.avplay.setBufferingParam` | `player/avplay.js` | Initial (4 s) and post-seek/stall (5 s) buffer; Samsung's minimum is 4 s |
| `webapis.avplay.setTimeoutForBuffering` | `player/avplay.js` | Keep playing if the buffer is not filled within 10 s (no long frozen screen after a seek) |
| `webapis.avplay.seekTo` | `player/avplay.js` | Seeking. Asynchronous and blocking: no other AVPlay call is made until the callback arrives; requests are queued |
| `getTotalTrackInfo` / `setSelectTrack` | `player/avplay.js` | Multiple audio / subtitle selection |
| `getStreamingProperty('CURRENT_BANDWIDTH')` | `player/avplay.js` | Diagnostics |
| `tizen.tvinputdevice.registerKey` | `js/core/keys.js` | Media, channel, color and number keys |
| `tizen.tvinputdevice.getSupportedKeys` | `js/core/keys.js` | Detecting firmware differences |
| `tizen.application.getCurrentApplication().exit()` | `js/core/router.js` | Exiting the app |
| `webapis.productinfo.getRealModel / getFirmware` | `views/settings.js` | System info screen |
| `webapis.productinfo.isUdPanelSupported` | `views/settings.js` | 4K panel detection |
| `tizen.systeminfo.getCapability(platform.version)` | `views/settings.js` | Tizen version |
| `tizen.filesystem.resolve / listStorages` | `services/backup.js` | Backup to USB / the Downloads folder |
| `MediaSource` / `SourceBuffer` (HTML5) | `player/mse.js` | App player: plays the MP4 fragments converted from MKV (H.264 + E-AC-3 are supported on this TV) |
| `tizen.filesystem.openFile('wgt-package/…')` | `services/presets.js` | Fallback for reading `hesaplar.txt` (Tizen 5.0+) |

Every call is guarded with `try/catch` and feature detection; newer features such as
`SET_MODE_4K` are silently disabled on old firmware.

---

## Error handling

All errors are converted to the `App.AppError` type; raw JavaScript errors are never shown
to the user and the app does not crash (`window.onerror` and `unhandledrejection` are caught).

| Code | When | Shown to the user (in Turkish) |
|---|---|---|
| `NETWORK` | Connection failed / server down | "Could not connect to the server…" |
| `TIMEOUT` | Request timed out | "The server did not respond in time…" |
| `AUTH` | 401/403 or `auth=0` | "Wrong username or password…" |
| `EXPIRED` | Account expired / banned | "Your account has expired…" |
| `PARSE` | HTML instead of JSON, broken M3U/XML | "The data from the server could not be read…" |
| `EMPTY` | Empty playlist | "No content to show." |
| `PLAYER` | AVPlay error | A description of the AVPlay error code |
| `OFFLINE` | The TV is not connected to the internet | "The TV is not connected to the internet…" |
| `STORAGE` | localStorage quota full | "Device storage is full…" |

- **Automatic retry on network errors** (1 retry + 1.2 s wait). `AUTH` and `404` are not
  retried.
- **If a stream does not open**, the format is switched first (`.m3u8` ↔ `.ts`), then it is
  retried twice; only then is an error shown to the user. For movies/episodes the retry
  starts **from where playback stopped**.
- **If a seek fails, never answers** (12 s; some firmware and files never call the
  callback) **or freezes the picture afterwards** (no progress for 20 s), the stream reopens
  by itself from the last position that was actually played; the player never stays frozen.
  If it happens again for the same item, seeking is disabled for it; if even the resume
  point cannot be reached, it plays from the beginning. History stores the position that
  was actually watched, never the seek target.
- **If the TV cannot read the seek index of an MKV file** (`player/seekcheck.js`), the file is
  opened with the app player. If that cannot open it either (unsupported codec, e.g. DTS
  audio), it is opened with AVPlay and seeking and resume are disabled up front. If the app
  player keeps failing during playback, the item is reopened with AVPlay from where it
  stopped. If the pre-check does not finish within 2.5 s or the server does not support
  partial reads (HTTP Range), nothing is blocked.
- **When zapping quickly**, a late success/error result from the previous stream is ignored;
  the wrong channel is never retried.
- **Missing EPG is not an error** — it is silently left empty and the channel still opens.
- **If `hesaplar.txt` cannot be read** or its lines cannot be understood, the app opens
  normally.

---

## Online subtitles (OpenSubtitles)

When the source's subtitles are broken, missing or **image-based** (DVB-SUB / PGS — AVPlay
does not provide these as text), you can fetch subtitles from OpenSubtitles in the player
with the **YELLOW** key → *Download subtitles from the internet* (*Internetten altyazi indir*).

**What you need (on the user's side):**

1. A free [OpenSubtitles](https://www.opensubtitles.com) account
2. Your own **API key** (My Account → *API Consumers* → *New Consumer*)
3. The key + username + password entered on the TV under *Settings → Subtitle Service*
   (*Ayarlar → Altyazi Servisi*) — or, to avoid re-entering it on every build, an
   `opensubtitles | API_KEY | USERNAME | PASSWORD` line in `hesaplar.txt`
   (see [hesaplar.txt](#enter-your-account-once-hesaplartxt))

> **No API key is embedded in the app.** The service's terms of use require every app to use
> its own key, and the download quota is charged to the key's owner. The details are stored
> only on the TV.

| Step | Details |
|---|---|
| Search | For episodes: **series name + season + episode**; for movies: **title + year**. Tags such as `1080p`, `WEB-DL` and `x264` are stripped to improve matching |
| Sorting | Trusted uploaders first, machine translations last; then by download count |
| Download | `POST /download` → temporary link → `.srt`. The remaining daily quota is shown on screen |
| Sync | Delay adjustment ±3 s. A **positive** value delays the subtitles, a **negative** value shows them earlier |
| Local cache | Every downloaded subtitle is stored on the device (IndexedDB); when the same episode is opened again, no internet request is made and no quota is used |
| Bulk download | *Download all subtitles for this season* (*Bu sezonun tum altyazilarini indir*) — skips the ones already saved, stops when the quota runs out, can be cancelled with RETURN |

**About the quota:** the OpenSubtitles daily quota is counted per file; 20 episodes use 20
downloads. The real saving is the local cache: a subtitle downloaded once stays on the device.
For a broken subtitle use the YELLOW key → **Download again** (*Yeniden indir*); to delete
them all, use *Settings → Clear subtitle cache* (*Ayarlar → Altyazi Onbellegini Temizle*).

**Limitations:** matching is based on the title, not the file name, so sync may not always be
perfect (that is what the delay adjustment is for). Not available for live streams. If an
episode record has no series name, no search is possible and the app says so clearly.

---

## Data storage and privacy

- All data is stored **only on the TV** (`localStorage` and IndexedDB).
- **No data is sent anywhere.** There is no analytics, advertising, telemetry or third-party
  tracking. The only network requests the app makes go to the IPTV server the user entered
  (and, optionally, to OpenSubtitles).
- The password is stored obfuscated with a device-specific key using **XOR + Base64**
  (`x1:` prefix). **This is not encryption**; its purpose is to stop someone looking at a
  storage dump from reading the password at a glance. Tizen TV web apps have no real keystore
  API.
- The **backup file** (`iptv-player-yedek.json`) contains your IPTV passwords in **plain
  text**. Do not share the USB stick with others.
- **`hesaplar.txt`** contains your link, your password and (if you added it) your
  OpenSubtitles key in plain text, and it goes into the `.wgt` package. The file is in
  `.gitignore` (it never enters the repository); **do not share the .wgt package with others.**
- **Settings → Reset app data** (*Ayarlar → Uygulama Verilerini Sifirla*) deletes everything.

---

## Tests

The project is tested automatically with `jsdom`; **no real TV is needed.**

```cmd
cd tests
npm init -y
npm install jsdom qrcode

node unit.test.js
node nav.test.js
node m3u.test.js
node qr.test.js
node subtitles.test.js
node e2e.test.js
```

```
tests/unit.test.js        56 checks   parsers, URL generation, virtual list, error types, modal focus
tests/nav.test.js         21 checks   remote arrow-key navigation (with real 1080p dimensions)
tests/m3u.test.js         43 checks   M3U series detection, group order, compact cache, BigStore
tests/qr.test.js          15 checks   QR encoder — matrix identical to the reference library
tests/subtitles.test.js   73 checks   SRT/VTT parsing, timeline, OpenSubtitles client
tests/e2e.test.js         62 checks   walking through every screen against a fake Xtream server
---------------------------------------------------------------------------------------------
                         270 checks
```

**Coverage:** startup → home → live TV (2,500 channels) → EPG → switching by channel number →
favorite → player → back → movies (600 posters) → series → season/episode → favorites →
recently watched → search → settings → exit confirmation on root RETURN. M3U and XMLTV
parsing, Xtream URL generation, password obfuscation, Turkish normalization, a
20,000-item virtual list and the cache not repeating requests are verified as well.

**QR encoder:** `js/ui/qrcode.js` was written from scratch (a CDN cannot be used because the
Tizen package works offline). Its correctness is tested by comparing it module by module with
the npm `qrcode` reference library: identical matrices for versions 1–13, error correction
levels L and M, including UTF-8 Turkish text. The reference library is only part of the
tests and never enters the app.

> **Do not include** the `tests/` folder in the `.wgt` package (see [Quick start](#installing-on-the-tv-summary)).

<details>
<summary><b>Development history: defects found and fixed in tests and on a real TV</b></summary>

&nbsp;

| Defect | Effect | Fix |
|---|---|---|
| Arrow-key navigation prioritized center distance over alignment | On the login screen ▼ skipped the text fields and went straight to the button | `js/core/nav.js` — in vertical movement, items with horizontal overlap always win |
| The player screen waited inside `mount()` until the stream was ready | On a dead channel the user could not press RETURN for ~30 s | `views/player.js` — the playback promise is not returned; state is driven by events |
| No item stayed focused after returning from a sub-screen | You could not see which item was selected on the remote | `js/core/router.js` — focus recovery in `activate()` |
| The "★ Favorites" category was at the top of the list | The channel list looked empty on first open | `views/live.js`, `movies.js`, `series.js` — Favorites moved after "All Channels" |
| `#EXTGRP` only worked when written after `#EXTINF` | In some playlists every group became "Other" | `services/m3u.js` — sticky group, both orders supported |
| The account expiry date only appeared after reopening the screen | At startup the top bar showed only the username | `views/home.js` — subscribes to the `profile:userinfo` event |
| `U.rem()` called `getComputedStyle()` on every row | Forced synchronous layout while scrolling, visible stutter | `js/core/utils.js` — the value is cached |
| List rows were rebuilt from scratch on every scroll | Needless DOM creation/removal | `virtualList.js` + views — `create`/`update` skeleton pattern |
| The focus ring was an outward `box-shadow` | `overflow:hidden` clipped it; the selected item was not fully visible | `css/*` — inward (inset) ring |
| Arrow keys in an empty list fell through to global navigation | Focus escaped to another column during category selection | `virtualList.js` — keys are swallowed in an empty list |
| Changing category emptied the list and showed "Loading" | Flicker and focus loss | `views/live.js` — the old content stays in place |
| M3U episodes were counted as movies | Series mixed into Movies, "no series" was reported | `services/m3u.js` — series/episode pattern detection + grouping |
| M3U groups were sorted alphabetically | Turkish categories did not appear at the top | `services/m3u.js` — playlist order is preserved |
| The parsed playlist exceeded the quota | Re-downloading + re-parsing on every start | `services/m3u.js` — compact encoding (83% smaller) |
| Reinstalling deleted all data | Saved playlists were lost on every build | `services/backup.js` — backup to USB/internal storage |
| The selected track was not visible in the audio/subtitle menu | You could not tell which one was playing | `player/controller.js` + `views/player.js` — ✔ mark |
| Fast-forward used a single fixed step | Long content needed far too many key presses | `views/player.js` — accelerating seek + single seek |
| Focus was not visible at all in modal dialogs | The selected row was unclear in audio/subtitle/confirm lists | `css/components.css` — the focus style required `[data-focusable]`, which modal items do not carry |
| Selected subtitles did not appear on screen | AVPlay does not render subtitles, it delivers the text via an event; the app did not draw it | `views/player.js` — `.subtitle` layer + `player:subtitle` listener |
| Audio/subtitle selection reset for every item | You had to choose again for every episode | `player/controller.js` — the language code is remembered persistently |
| The OK key did not pause | The center key only opened the info bar | `views/player.js` — OK now pauses/resumes; the info bar is on the INFO key |
| Some subtitles never arrived | AVPlay does not deliver image-based subtitles as text, and the reason was unclear | `views/player.js` — an explanatory warning if no text arrives within 12 s |
| The automatic language preference overrode a manual choice | It could switch back 1 s after selection | `player/controller.js` — `manualPick` guard |
| The series name was lost from episode records | An episode opened from Favorites/Recently Watched was titled "Episode 1", and the subtitle search used that | `services/favorites.js`, `history.js` — `seriesName`/`season`/`episodeNum` are stored |
| In bulk download a download error silently stopped the loop | "Loading" stayed stuck on screen | `views/player.js` — a single `.catch()` |
| A large playlist did not fit in the localStorage quota | Re-downloading on every start | `js/core/bigstore.js` (IndexedDB) + prefix compression in `services/m3u.js` |
| Other AVPlay calls were made while `seekTo` was running (a second seek, pause, track list) | The picture froze on fast-forward | `player/avplay.js` — busy lock: requests are queued, only the last target is applied |
| A seek was calculated from the old position, not from the target of the seek in progress | ⏩ could jump backwards instead of forwards | `player/controller.js` — `seekState`; stale positions during a seek are ignored |
| ⏪ ⏩ sent a separate `seekTo` on every press | Repeated presses caused overlapping seeks and freezes | `views/player.js` — the same accumulation as the arrow keys + a single seek |
| `setBufferingParam` was given 2 s (Samsung's minimum is 4 s) | Re-buffering after a seek misbehaved | `player/avplay.js` — 4 / 5 s; `setTimeoutForBuffering` 20 → 10 s |
| The audio/subtitle list was read while the resume seek was running | Freeze when opening an episode | `player/controller.js` — language preference is applied after the seek |
| On fast zapping the previous stream's result affected the new one | The wrong channel was retried | `player/controller.js` — `streamGen` ignores stale results |
| Retrying after a network error restarted VOD from the beginning | The movie went back to the start | `player/controller.js` — resumes from the last position |
| The state became "paused" even though the live stream rejected the pause | The screen said "Paused" while the picture kept running | `player/controller.js` — the engine's result is checked |
| The look-ahead padding in the virtual list was always a full row | In the poster grid the selected row was cut off at the top and the list scrolled back | `virtualList.js` — `anchor`/`edge` scrolling, bounded padding, exactly two rows with `posterGrid()` |
| The poster focus ring was an `inset box-shadow` | It stayed behind the image; the selected poster was not visible | `css/components.css` — a `::after` layer on top of the image |
| `.modal__list` was not positioned (`offsetTop` used the wrong reference) | Scrolling down the subtitle list made it jump up | `css/components.css` + `js/ui/modal.js` |
| The subtitle's `bottom` value changed abruptly with the info bar | Subtitles jumped up | `css/views.css` — `transform` transition |
| The `.list` rule overrode the positioning of `.col__body` | Column headers overlapped the first row | `css/components.css` — `.list` sets no position |
| The settings list container was not positioned | Rows covered the right-hand panel and text overflowed | `css/views.css` — `.settings__list { position: relative }` |
| Refreshing a list reset the scroll and centered the focus | In Settings the list jumped on every OK | `virtualList.js` — `keepScroll` |
| The login card was ~1200 px tall | On a 1080p screen its top and the "Connect" button were cut off | `views/login.js`, `opensubtitles.js` — two-column card |
| The body extended to the very bottom of the screen | The hint bar covered the lists | `css/layout.css` — bottom spacing for the body |
| In Live TV the RED key called an undefined `afterChannels()` | Refresh threw an error and the filter was ignored | `views/live.js` |
| Saved playlists were deleted on every build | The long link had to be typed with the remote on every install | `services/presets.js` + `hesaplar.txt` |
| The OpenSubtitles key was deleted on every build | The subtitle service had to be entered again on every install | `services/presets.js` — `opensubtitles \|` line |
| In some MKV files (e.g. Friends) the seek index was referenced only by a second SeekHead at the end of the file, not by the first one | AVPlay rejected every seek at once (`PLAYER_ERROR_SEEK_FAILED`) and the picture then got stuck; HTML5 `<video>` froze too | `player/seekcheck.js` detects it in advance; `player/mse.js` (+ `mkv.js`, `fmp4.js`) reads the file itself and plays it through Media Source |
| "Start over" sent `startMs: 0` and the player treated 0 as "not given" | With auto-resume enabled, "Start over" still seeked to the saved position | `player/controller.js` — a numeric start position (including 0) is honored |
| Seeks were calculated from the position report that is updated every half second | A 10 s seek became ~9.5 s | `player/controller.js` — `getLivePosition()`: the player's live position |
| While playing, AVPlay jumped to the nearest keyframe | A 10 s forward seek became 11–12 s, a backward one 8–9 s (a keyframe every 2 s) | Settings → Movie/Series Player → *App player*: lands exactly on the requested frame |
| The seek target was saved as the resume point even when the seek failed | For some series the picture froze after fast-forwarding; restarting with BLUE or reopening the episode seeked to the same point and froze again | `player/controller.js` — actually-played position (`goodPos`), stall watchdog, automatic reopen; `player/avplay.js` — no queued commands are sent to a stuck player |

</details>

---

## Known limitations

- **Series only work fully with Xtream Codes** sources; M3U has no season/episode structure.
- **DRM-protected content is not supported.** If needed, add the
  `http://developer.samsung.com/privilege/drmplay` privilege to `config.xml` and a DRM
  configuration to AVPlay.
- **No catch-up / archive playback.** The Xtream API's `tv_archive` information is read and
  kept in the data model, but this version has no archive playback interface.
- MPEG-TS/HLS cannot be played in a PC browser (see [Quick start](#try-it-on-a-pc-first-no-tv-needed)).
- **Favorites, watch history and settings** are still deleted on reinstall (`hesaplar.txt`
  only covers accounts and the subtitle service). The USB backup uses
  `tizen.filesystem.resolve()`, which has been deprecated since Tizen 5.0 and may not work on
  newer models.
- **Live streams cannot be paused** (there is no time-shift); pressing PLAY/PAUSE says so on
  screen.
- **The app player only handles MKV** files with H.264/H.265 video and E-AC-3/AC-3/AAC audio;
  it does not show image-based subtitles (PGS/VobSub). Live TV and other formats are always
  opened with AVPlay. An MKV whose seek index is referenced only by a second SeekHead at the
  end of the file and that uses other codecs cannot be seeked; the real fix is for the
  provider to remux the file (e.g. `mkvmerge -o new.mkv old.mkv`).

---

## Contributing

Contributions are welcome. Before opening a pull request:

- **Use ES5 syntax** (`var`, `function`; no `class`, template literals or `async/await`).
- **Follow the layer rule:** `views/` never calls `App.Xtream` / `App.M3U` directly, only
  `App.Content`.
- **Do not add a framework or runtime dependency.** The package works offline.
- **Never put a real server address, username, password or API key** in code, tests or
  examples; use placeholders such as `http://SERVER:PORT`.
- Guard every `webapis.*` / `tizen.*` call with `try/catch` and feature detection.
- Run the tests (see [Tests](#tests)); add tests for new behavior.
- **Do not commit** image files (`icon.png`, `assets/splash.jpg`), your personal
  `hesaplar.txt` or signing certificates (`*.p12`, `*.pwd`, `*.pri`) (they are all in
  `.gitignore`).
- If you add a new AVPlay call, route it through the lock in `player/avplay.js` (`_run`);
  calling AVPlay directly while `seekTo` / `prepareAsync` is running freezes the picture.
- Code comments and user-facing texts are in Turkish; keep new texts consistent with them.

When reporting a bug, include the TV model, the Tizen version (*Settings → System Info* /
*Ayarlar → Sistem Bilgisi*) and, if possible, the output of
`sdb dlog -v time | findstr /i "ConsoleMessage"`.

---

## License

This project is distributed under the terms of the [LICENSE](LICENSE) file.
