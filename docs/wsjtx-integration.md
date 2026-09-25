# WSJTX Integration Guide

Operate FT8, FT4, JT65, WSPR, and other digital modes via WSJTX while
controlling your radio remotely through RigControl Web.

## Architecture

```
WSJTX ──TCP (rigctld)──→ wsjtx-bridge (localhost)
                               ↕ WebSocket
                          Browser Tab
                               ↕ Socket.io (WSS)
                          RigControl Web Server
                               ↕ TCP
                             rigctld → Radio
```

**Rig control** flows through a local `wsjtx-bridge` helper binary that speaks
the Hamlib rigctld protocol to WSJTX and relays commands to RigControl Web via
the browser's existing encrypted connection.  rigctld is never exposed to the
network.

**Audio** is routed through virtual audio cables:
- RX: server → browser → virtual cable → WSJTX (for decoding)
- TX: WSJTX → virtual cable → browser mic capture → server → radio

## Prerequisites

- RigControl Web running and connected to your radio
- WSJTX installed on your local machine (the same machine running the browser)
- Virtual audio cables (see platform-specific setup below)
- Chrome or Edge browser (required for `setSinkId` audio routing)

## Step 1: Virtual Audio Setup

### Linux (fully automated)

No manual setup needed.  The `wsjtx-bridge` helper automatically creates
virtual audio devices via PipeWire (`pw-loopback`) on startup and removes
them on exit.  Requires PipeWire (standard on Fedora, Ubuntu 22.04+, and
most modern distros).

Use `--no-audio` to skip automatic virtual audio creation if you prefer to
manage devices manually.

### macOS

Install [BlackHole](https://github.com/ExistentialAudio/BlackHole) (free,
open-source):

```bash
brew install blackhole-2ch
```

BlackHole provides a single 2-channel virtual audio device.  You may need a
second virtual device for the TX path — install `blackhole-16ch` or use
[Loopback](https://rogueamoeba.com/loopback/) if you need two independent
cables.

### Windows

Two virtual audio cables are required for bidirectional audio (RX and TX
paths).  RigControl Web auto-detects the following VB-Audio products:

**Option A — Two free cables (recommended):**
1. Install [VB-CABLE](https://vb-audio.com/Cable/) (free/donationware)
2. Install [Hi-Fi CABLE & ASIO Bridge](https://vb-audio.com/Cable/) (free/donationware, separate download)

**Option B — Donation bundle:**
1. Install [VB-CABLE A+B](https://vb-audio.com/Cable/) (~5 EUR donation)

Auto-setup assigns the first detected cable as **RX** (browser → WSJTX) and
the second as **TX** (WSJTX → browser).  Detection priority:
VB-CABLE → Hi-Fi CABLE → Cable A → Cable B → Cable C → Cable D.

With Option A (VB-CABLE + Hi-Fi CABLE):
- RX cable: `CABLE Input / CABLE Output (VB-Audio Virtual Cable)`
- TX cable: `Hi-Fi Cable Input / Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)`

With Option B (VB-CABLE A+B):
- RX cable: `CABLE-A Input / CABLE-A Output (VB-Audio Cable A)`
- TX cable: `CABLE-B Input / CABLE-B Output (VB-Audio Cable B)`

## Step 2: Start the Helper

Run the `wsjtx-bridge` binary on your local machine:

```bash
./wsjtx-bridge          # Linux
./wsjtx-bridge          # macOS
wsjtx-bridge.exe        # Windows
```

On Linux you should see:
```
READY 4540 4541
wsjtx-bridge: Virtual audio devices created (PipeWire)
  WSJTX Soundcard Input:   RCW-WSJTX-RX
  WSJTX Soundcard Output:  RCW-WSJTX-TX
  RCW WSJTX Audio Output:  RCW-WSJTX-RX
  RCW Local Input (Mic):   RCW-WSJTX-TX
```

The helper listens on:
- **TCP port 4540** — rigctld protocol for WSJTX
- **WebSocket port 4541** — JSON protocol for the browser

Custom ports: `wsjtx-bridge --tcp-port 4550 --ws-port 4551`

## Step 3: RigControl Web Configuration

Open Audio Settings in RigControl Web:

1. **Enable WSJTX Bridge** — toggle on in the WSJTX / Digital Mode Bridge
   section.  The status should show "Connected" (green) if the helper is
   running.

2. **Audio auto-setup** — on Linux and Windows, audio devices are
   auto-configured when the bridge connects.  The status banner shows
   "Auto-configured" (green) when successful.  If auto-setup fails, configure
   manually:

   **WSJTX Audio Output** (RX cable — browser plays radio audio here):
   - Linux: `RCW-WSJTX-RX` (auto-detected)
   - macOS: `BlackHole 2ch`
   - Windows: `CABLE Input (VB-Audio Virtual Cable)` (auto-detected)

   **Local Input (Microphone)** (TX cable — captures WSJTX transmitted audio):
   - Linux: `RCW-WSJTX-TX` (auto-detected)
   - macOS: Second BlackHole device or loopback
   - Windows: `Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)` (auto-detected)

3. **Unmute your mic** when ready to transmit via WSJTX.

## Step 4: WSJTX Configuration

In WSJTX → Settings → Radio:
- **Rig:** Hamlib NET rigctl
- **Network Server:** `localhost:4540`
- **PTT Method:** CAT (or RIG — both work through the bridge)

In WSJTX → Settings → Audio:
- **Soundcard Input** (WSJTX hears radio — RX cable output):
  - Linux: `RCW-WSJTX-RX`
  - macOS: `BlackHole 2ch`
  - Windows (VB-CABLE + Hi-Fi): `CABLE Output (VB-Audio Virtual Cable)`
  - Windows (A+B): `CABLE-A Output (VB-Audio Cable A)`
- **Soundcard Output** (WSJTX transmits — TX cable input):
  - Linux: `RCW-WSJTX-TX`
  - macOS: Second BlackHole device
  - Windows (VB-CABLE + Hi-Fi): `Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)`
  - Windows (A+B): `CABLE-B Input (VB-Audio Cable B)`

## Testing

1. Tune to **14.074 MHz USB** (FT8 calling frequency)
2. Wait for a 15-second decode window
3. Verify FT8 signals appear in WSJTX's waterfall and decode list
4. Try a test CQ — verify PTT engages, audio transmits, and PTT releases

## Troubleshooting

**Bridge shows "Waiting" (yellow)**
- Is `wsjtx-bridge` running?  Check for `READY 4540 4541` in its output.
- Is the WebSocket port correct?  Default is 4541.
- Chrome/Edge only — Firefox and Safari have limited `setSinkId` support.

**No audio in WSJTX waterfall**
- Is the WSJTX Audio Output device set in RigControl Web?
- Is the backend audio engine started and playing?
- Check the volume — the WSJTX output bypasses mute/volume controls, but the
  backend must be streaming audio.

**Bridge stays "Waiting" even though it is running (helper log says "WebSocket handshake rejected")**
- The helper only accepts WebSocket connections from a RigControl Web page served over `https://` from `localhost`, `127.0.0.1`, or a private LAN address (10.x.x.x, 172.16-31.x.x, 192.168.x.x). This stops other web pages open in your browser from taking over rig control.
- If you reach RigControl Web through a public hostname, a reverse proxy, or a VPN address outside those ranges, open it by its LAN IP address or `localhost` instead.

**WSJTX can't connect to rig**
- Verify `wsjtx-bridge` is running and shows `READY`.
- In WSJTX, ensure Rig is "Hamlib NET rigctl" and server is `localhost:4540`.
- Check for port conflicts — another program may be using port 4540.

**PTT doesn't engage**
- Verify the rig is connected in RigControl Web (frequency/mode showing).
- Check that WSJTX's PTT method is set to CAT.

**Audio latency / missed decodes**
- Network audio adds ~100-300 ms depending on your connection.  WSJTX
  compensates internally, but high-latency or lossy connections may affect
  decode rates.
- For best results, use a wired LAN connection to the RigControl Web server.
