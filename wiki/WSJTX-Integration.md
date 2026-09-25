# WSJTX Integration

Operate FT8, FT4, JT65, WSPR, and other digital modes via WSJTX while controlling your radio remotely through RigControl Web.

---

## How It Works

```
WSJTX ──TCP (rigctld)──→ wsjtx-bridge (localhost)
                               ↕ WebSocket
                          Browser Tab
                               ↕ Socket.io (WSS)
                          RigControl Web Server
                               ↕ TCP
                             rigctld → Radio
```

**Rig control** flows through a local `wsjtx-bridge` helper binary that speaks the Hamlib rigctld protocol to WSJTX and relays commands to RigControl Web via the browser's existing encrypted connection. rigctld is never exposed to the network.

**Audio** is routed through virtual audio cables:
- **RX:** server → browser → virtual cable → WSJTX (for decoding)
- **TX:** WSJTX → virtual cable → browser mic capture → server → radio

---

## Prerequisites

- RigControl Web running and connected to your radio
- WSJTX installed on your local machine (the same machine running the browser)
- Virtual audio cables (see platform-specific setup below)
- Chrome or Edge browser (required for `setSinkId` audio routing)

### Tested platforms

This integration has been tested on **Windows 11 Pro** and **modern Fedora** (PipeWire) only. **macOS is untested** due to lack of hardware — the instructions below are based on research and may require adjustment. Community feedback is welcome.

### Linux audio server requirements

Automatic virtual audio device creation requires **PipeWire** (`pw-loopback`). Distros that ship PipeWire as the default audio server:

- **Fedora 34+** (since 2021)
- **Ubuntu 22.04+** (since 2022)
- **Debian 12+** (since 2023)

PulseAudio-only systems (e.g. Ubuntu 20.04, Debian 11, older Fedora) are **not supported** by the automatic audio setup. PulseAudio users will need to create virtual audio devices manually (e.g. via `pactl load-module module-null-sink`) and configure them by hand in Steps 3 and 4.

---

## Step 1: Virtual Audio Setup

### Linux (PipeWire — fully automated)

No manual setup needed. The `wsjtx-bridge` helper automatically creates virtual audio devices via PipeWire (`pw-loopback`) on startup and removes them on exit. See [Linux audio server requirements](#linux-audio-server-requirements) above for supported distros.

Use `--no-audio` to skip automatic virtual audio creation if you prefer to manage devices manually or are running PulseAudio.

### macOS

Two virtual audio devices are required for bidirectional audio (RX and TX paths). Audio must be configured manually on macOS — auto-setup is not yet supported. **macOS is untested** — see [Tested platforms](#tested-platforms).

**Option A — BlackHole 2ch + 16ch (recommended, free):**

Install both [BlackHole](https://github.com/ExistentialAudio/BlackHole) channel variants — they appear as two independent virtual audio devices:

```bash
brew install blackhole-2ch
brew install blackhole-16ch
```

After installation, verify both devices appear in **Audio MIDI Setup** (Applications → Utilities):
- `BlackHole 2ch` — used as the **RX** cable (browser → WSJTX)
- `BlackHole 16ch` — used as the **TX** cable (WSJTX → browser)

**Option B — VB-CABLE A+B for Mac (donationware, ~$5–$25):**

Purchase from the [VB-Audio shop](https://shop.vb-audio.com/en/mac-apps/30-vb-cable-ab-mac.html). Provides two independent virtual cables (Cable A and Cable B). Supports macOS 10.10+ on both Intel and Apple Silicon.

> **Note:** The free [VB-CABLE for Mac](https://shop.vb-audio.com/en/mac-apps/29-vb-cable-mac.html) (`brew install --cask vb-cable`) provides only one virtual cable, which is not sufficient by itself. You would need to pair it with BlackHole for a second cable, but using two BlackHole devices (Option A) is simpler and fully free.
>
> Hi-Fi CABLE is **not available on macOS** — it is a Windows-only product.

### Windows

Two virtual audio cables are required for bidirectional audio (RX and TX paths). RigControl Web auto-detects the following VB-Audio products:

**Option A — Two free cables (recommended):**
1. Install [VB-CABLE](https://vb-audio.com/Cable/) (free/donationware)
2. Install [Hi-Fi CABLE & ASIO Bridge](https://vb-audio.com/Cable/) (free/donationware, separate download)

**Option B — Donation bundle:**
1. Install [VB-CABLE A+B](https://vb-audio.com/Cable/) (donationware, ~5 EUR)

Auto-setup assigns the first detected cable as **RX** (browser → WSJTX) and the second as **TX** (WSJTX → browser). Detection priority: VB-CABLE → Hi-Fi CABLE → Cable A → Cable B → Cable C → Cable D.

**Device names with Option A (VB-CABLE + Hi-Fi CABLE):**

| Cable | Playback device (audiooutput) | Recording device (audioinput) |
|-------|-------------------------------|-------------------------------|
| RX | `CABLE Input (VB-Audio Virtual Cable)` | `CABLE Output (VB-Audio Virtual Cable)` |
| TX | `Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)` | `Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)` |

**Device names with Option B (VB-CABLE A+B):**

| Cable | Playback device (audiooutput) | Recording device (audioinput) |
|-------|-------------------------------|-------------------------------|
| RX | `CABLE-A Input (VB-Audio Cable A)` | `CABLE-A Output (VB-Audio Cable A)` |
| TX | `CABLE-B Input (VB-Audio Cable B)` | `CABLE-B Output (VB-Audio Cable B)` |

> **Note:** VB-CABLE and Hi-Fi CABLE are both donationware — free to use with an optional donation to the developer. VB-CABLE A+B is also donationware, available for a suggested donation of ~5 EUR.

---

## Step 2: Download and Start the Helper

Download the `wsjtx-bridge` binary for your platform:

| Platform | Download |
|----------|----------|
| Linux | [wsjtx-bridge-linux](https://jbdubbs.github.io/Rig-Control-Web/downloads/wsjtx-bridge-linux) |
| macOS | [wsjtx-bridge-mac](https://jbdubbs.github.io/Rig-Control-Web/downloads/wsjtx-bridge-mac) |
| Windows | [wsjtx-bridge.exe](https://jbdubbs.github.io/Rig-Control-Web/downloads/wsjtx-bridge.exe) |

On Linux and macOS, make the binary executable after downloading: `chmod +x wsjtx-bridge-*`

Run it on your local machine:

**Linux:**
```bash
./wsjtx-bridge
```

Expected output:
```
READY 4540 4541
wsjtx-bridge: Virtual audio devices created (PipeWire)
  WSJTX Soundcard Input:   RCW-WSJTX-RX
  WSJTX Soundcard Output:  RCW-WSJTX-TX
  RCW WSJTX Audio Output:  RCW-WSJTX-RX
  RCW Local Input (Mic):   RCW-WSJTX-TX
```

**macOS:**
```bash
./wsjtx-bridge
```

Expected output:
```
READY 4540 4541
wsjtx-bridge v0.2.4: TCP (rigctld) on localhost:4540, WebSocket on localhost:4541
```

Virtual audio is not created automatically on macOS — use the devices you installed in Step 1.

**Windows:**
```
wsjtx-bridge.exe
```

Expected output:
```
READY 4540 4541
wsjtx-bridge v0.2.4: TCP (rigctld) on localhost:4540, WebSocket on localhost:4541
```

Virtual audio is not created automatically on Windows — use the VB-Audio cables you installed in Step 1.

---

The helper listens on:
- **TCP port 4540** — rigctld protocol for WSJTX
- **WebSocket port 4541** — JSON protocol for the browser

Custom ports: `wsjtx-bridge --tcp-port 4550 --ws-port 4551`

---

## Step 3: RigControl Web Configuration

Open Audio Settings in RigControl Web:

1. **Enable WSJTX Bridge** — toggle on in the WSJTX / Digital Mode Bridge section. The status should show "Connected" (green) if the helper is running.

2. **Audio auto-setup** — on Linux and Windows, audio devices are auto-configured when the bridge connects. The status banner shows "Auto-configured" (green) when successful. On macOS, manual configuration is required.

   If auto-setup fails or you're on macOS, configure the two audio routes manually:

   **WSJTX Audio Output** (RX cable — browser plays radio audio here for WSJTX to decode):
   - Linux: `RCW-WSJTX-RX` (auto-detected)
   - macOS (BlackHole): `BlackHole 2ch`
   - macOS (VB-CABLE A+B): `VB-Cable A`
   - Windows (VB-CABLE + Hi-Fi): `CABLE Input (VB-Audio Virtual Cable)` (auto-detected)
   - Windows (A+B): `CABLE-A Input (VB-Audio Cable A)` (auto-detected)

   **Local Input (Microphone)** (TX cable — captures WSJTX transmitted audio):
   - Linux: `RCW-WSJTX-TX` (auto-detected)
   - macOS (BlackHole): `BlackHole 16ch`
   - macOS (VB-CABLE A+B): `VB-Cable B`
   - Windows (VB-CABLE + Hi-Fi): `Hi-Fi Cable Output (VB-Audio Hi-Fi Cable)` (auto-detected)
   - Windows (A+B): `CABLE-B Output (VB-Audio Cable B)` (auto-detected)

3. **Unmute your mic** when ready to transmit via WSJTX.

> **Important:** You must manually click "Join Audio" before auto-setup takes effect. Browser autoplay policy prevents programmatic audio context creation without a user gesture.

---

## Step 4: WSJTX Configuration

In WSJTX → Settings → **Radio:**
- **Rig:** Hamlib NET rigctl
- **Network Server:** `localhost:4540`
- **PTT Method:** CAT (or RIG — both work through the bridge)

In WSJTX → Settings → **Audio:**

**Linux:**

| Setting | Device |
|---------|--------|
| **Soundcard Input** (hears radio) | `RCW-WSJTX-RX` |
| **Soundcard Output** (transmits) | `RCW-WSJTX-TX` |

**macOS (BlackHole 2ch + 16ch):**

| Setting | Device |
|---------|--------|
| **Soundcard Input** (hears radio) | `BlackHole 2ch` |
| **Soundcard Output** (transmits) | `BlackHole 16ch` |

**macOS (VB-CABLE A+B):**

| Setting | Device |
|---------|--------|
| **Soundcard Input** (hears radio) | `VB-Cable A` |
| **Soundcard Output** (transmits) | `VB-Cable B` |

**Windows (VB-CABLE + Hi-Fi CABLE):**

| Setting | Device |
|---------|--------|
| **Soundcard Input** (hears radio) | `CABLE Output (VB-Audio Virtual Cable)` |
| **Soundcard Output** (transmits) | `Hi-Fi Cable Input (VB-Audio Hi-Fi Cable)` |

**Windows (VB-CABLE A+B):**

| Setting | Device |
|---------|--------|
| **Soundcard Input** (hears radio) | `CABLE-A Output (VB-Audio Cable A)` |
| **Soundcard Output** (transmits) | `CABLE-B Input (VB-Audio Cable B)` |

---

## Testing

1. Tune to **14.074 MHz USB** (FT8 calling frequency)
2. Wait for a 15-second decode window
3. Verify FT8 signals appear in WSJTX's waterfall and decode list
4. Try a test CQ — verify PTT engages, audio transmits, and PTT releases

---

## Troubleshooting

**Bridge shows "Waiting" (yellow)**
- Is `wsjtx-bridge` running? Check for `READY 4540 4541` in its output.
- Is the WebSocket port correct? Default is 4541.
- Chrome/Edge only — Firefox and Safari have limited `setSinkId` support.

**No audio in WSJTX waterfall**
- Is the WSJTX Audio Output device set in RigControl Web?
- Is the backend audio engine started and playing?
- Check the volume — the WSJTX output bypasses mute/volume controls, but the backend must be streaming audio.

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

**Windows: "Only one virtual cable detected"**
- You need two VB-Audio cables installed. Install Hi-Fi CABLE (free) alongside VB-CABLE, or donate for VB-CABLE A+B.

**Windows: "Virtual audio cables not detected"**
- Install VB-CABLE and Hi-Fi CABLE from [vb-audio.com](https://vb-audio.com/Cable/), or donate for VB-CABLE A+B.
- Restart the browser after installing new audio drivers.

**macOS: No virtual audio devices appear in dropdowns**
- Verify both devices are installed: open **Audio MIDI Setup** (Applications → Utilities) and confirm you see `BlackHole 2ch` and `BlackHole 16ch` (or `VB-Cable A` and `VB-Cable B` if using VB-CABLE A+B).
- If you installed via Homebrew, try `brew reinstall blackhole-2ch blackhole-16ch` and restart.
- macOS may require granting microphone permission to Chrome/Edge — check **System Settings → Privacy & Security → Microphone**.

**macOS: Audio auto-setup is not supported**
- macOS virtual audio devices must be configured manually in RigControl Web. See Step 3 for the correct device assignments.

**Audio latency / missed decodes**
- Network audio adds ~100-300 ms depending on your connection. WSJTX compensates internally, but high-latency or lossy connections may affect decode rates.
- For best results, use a wired LAN connection to the RigControl Web server.
