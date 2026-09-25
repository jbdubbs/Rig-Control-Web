# Diagnostic Logging

When something is not working as expected — audio cutting out, the rig not connecting, the keyer misbehaving — diagnostic logging captures a detailed trace of what the app is doing internally. This output is the most useful thing you can include in a bug report.

---

## In-App Diagnostics Tab (Recommended)

The easiest way to capture a diagnostic log no longer requires relaunching the app from a terminal. Open **General Settings** (gear icon) → **DIAGNOSTICS** tab:

- **Debug Flags** — check any of the subsystem flags (Rig, Audio, Video, CW, Infra, Spectrum, Spots, DX Cluster, WSJTX, FT8) to turn on that logging immediately, with no restart needed. Click **Enable All** to turn everything on at once.
- **Diagnostic Log** — a live, scrolling panel showing merged output from the server console, the Electron renderer console, and every connected browser tab's console, combined into a single timestamped feed. It keeps a rolling 10-minute buffer.
- **Copy Log** / **Save Log** — grab everything currently in the buffer as text, ready to paste or attach to a bug report.

Flag choices made here are saved to `settings.json` and persist across restarts. If the app was also launched with a `--debug-*` command-line flag (see below), the command-line flag always wins over a persisted "off" — you can't accidentally disable logging that was explicitly requested at launch.

The Diagnostics tab is available to any logged-in user, not just admins, so a remote operator having trouble can capture their own log without shell access to the server machine.

---

## Command-Line Flags

The Diagnostics tab covers most cases, but launching with a `--debug-*` flag is still useful if you need logging active from the very first line of server startup (before you can log in and open Settings), or you're running headless with no browser open at all.

RigControl Web supports the following diagnostic flags. Launch the app with one or more of them to enable logging for the relevant subsystem:

| Flag | What it captures |
|------|-----------------|
| `--debug-rig` | Hamlib command traffic, capability detection, poll cycle, VFO probe |
| `--debug-audio` | Audio pipeline — encoding, decoding, device selection, jitter buffer activity |
| `--debug-video` | Video chunk relay, encoder and decoder events |
| `--debug-cw` | CW keyer state machine, DTR/RTS serial line changes |
| `--debug-infra` | Server startup, shutdown steps, TLS certificate, settings file reads/writes |
| `--debug-spectrum` | Spectrum scope (both sources) — Hamlib UDP socket binding, multicast interface joins, per-packet receive/parse/emit trace, 10 s throughput counter; FT4222 reader lifecycle, frame parse errors, resync events, restart timing |
| `--debug-spots` | POTA, SOTA, and WWFF spot fetching — HTTP request/response status, spot counts, filter pipeline (dedup, age, mode, band drop counts), sample timestamps for diagnosing clock-related filtering issues |
| `--debug-dxcluster` | DX Cluster telnet connection — connect/login handshake, raw data received, parsed vs. unparsed lines, reconnect attempts and the 3-attempts-per-minute budget, settings-triggered restarts |
| `--debug-wsjtx` | WSJTX bridge — WebSocket lifecycle, rig command relay between WSJT-X and RigControl Web |
| `--debug-ft8` | FT8 decoder — browser-side only (WASM load, audio flow, decode calls); output appears in the Diagnostic Log and the browser DevTools console |
| `--debug-all` | All of the above at once |

Flags can be combined. For example, if your problem involves audio and the rig connection together, use `--debug-rig --debug-audio`.

**If you are unsure which flag to use, use `--debug-all`.** It produces more output but guarantees nothing is missed.

---

## Launching With a Debug Flag

### Windows (Electron App)

Open a Command Prompt, then run:

```
"C:\Program Files\RigControl Web\RigControl Web.exe" --debug-all
```

The path may vary depending on where you installed the app. You can also find the executable by right-clicking the Start Menu shortcut → **Open file location**.

Server-side log output appears in the Command Prompt window. Keep this window open while you reproduce the problem.

### Linux (AppImage)

Open a terminal, then run the AppImage directly:

```
./RigControl-Web-<version>.AppImage --debug-all
```

If you installed the app to a specific location, use its full path. Server-side log output appears in the terminal. Keep the terminal open while you reproduce the problem.

### Development (from Source)

```
npm run dev -- --debug-all
```

Log output appears in the terminal where you ran the command.

### Docker / Docker Compose (Headless)

There's no interactive terminal to pass `--debug-*` args to in a container, so use the environment-variable form instead — every flag has a matching env var (`DEBUG_ALL`, `DEBUG_RIG`, `DEBUG_AUDIO`, `DEBUG_VIDEO`, `DEBUG_CW`, `DEBUG_INFRA`, `DEBUG_SPECTRUM`, `DEBUG_SPOTS`, `DEBUG_DXCLUSTER`, `DEBUG_WSJTX`, `DEBUG_FT8`), set to `"1"`. In `docker-compose.yml`, add it to the existing `environment:` block alongside `RCW_DATA_DIR`:

```yaml
environment:
  RCW_DATA_DIR: /data
  DEBUG_ALL: "1"
```

Then `docker compose up -d` (or `docker compose restart` if it's already running). For plain `docker run`, add `-e DEBUG_ALL=1` to the command shown in [Headless Deployment](Headless-Deployment). View output with `docker compose logs -f` (or `docker logs -f rigcontrol-web`).

### systemd (Headless)

Add an `Environment=` line to the `[Service]` block of `/etc/systemd/system/rigcontrol-web.service`:

```
Environment=DEBUG_ALL=1
```

Then apply it and watch the log:

```
sudo systemctl daemon-reload
sudo systemctl restart rigcontrol-web
journalctl -u rigcontrol-web -f
```

---

## Capturing the Output

### Server-Side Logs (Terminal)

The server-side diagnostic output prints in the terminal or Command Prompt where you launched the app. To save it to a file for attaching to a bug report:

**Windows:**
```
"RigControl Web.exe" --debug-all > rigcontrol-log.txt 2>&1
```

**Linux:**
```
./RigControl-Web-<version>.AppImage --debug-all > rigcontrol-log.txt 2>&1
```

This creates a `rigcontrol-log.txt` file in the current directory containing everything printed to the console.

### Browser-Side Logs (DevTools Console)

Diagnostic flags are also forwarded to connected browser clients. Browser-side output (audio pipeline events, video decoder events, keyer state transitions) appears in the **DevTools console** of the browser tab running the app.

To open DevTools:

- **Chrome / Edge:** Press `F12` or `Ctrl+Shift+J` (Windows/Linux) / `Cmd+Option+J` (macOS)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable the Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

Switch to the **Console** tab. Filter by `[RIG]`, `[AUDIO]`, `[VIDEO]`, `[CW]`, `[INFRA]`, or `[spots` to narrow down to the relevant subsystem.

To save the console output: right-click anywhere in the Console panel → **Save as...** (Chrome/Edge) or copy the visible output.

---

## What to Include in a Bug Report

A useful bug report includes:

1. **A description of what you expected to happen and what actually happened.**
2. **Steps to reproduce** — what you clicked, in what order, starting from a fresh launch.
3. **A diagnostic log**, captured from just before and during the problem — either the saved output from the in-app Diagnostics tab, or the terminal output with `--debug-all`.
4. **Browser console output** (DevTools console), captured during the same window, if you didn't use the Diagnostics tab (which already merges this in).
5. **Your setup:** operating system, RigControl Web version, radio model, and how it is connected (USB audio, Digirig, etc.).

Attach the log files or paste the relevant sections as text in the bug report. Logs with timestamps are especially helpful — the server prefixes lines with step context, and the browser console timestamps each entry.

**File a bug report at:** [https://github.com/jbdubbs/Rig-Control-Web/issues](https://github.com/jbdubbs/Rig-Control-Web/issues)
