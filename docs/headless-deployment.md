# Headless Deployment (Pi / Mini PC)

RigControl Web's backend (`server.ts`) runs standalone — no Electron, no
GUI, no display server required. This makes it a good fit for a dedicated
radio-controller box (Raspberry Pi, N100/N150 mini PC, an old laptop, a
NAS) running headless in the shack, controlled remotely from a browser on
another machine.

This guide covers three ways to run it: **Docker Compose** (recommended),
plain `docker run`, and **systemd** (no container runtime). Commands below
use `docker`; `podman` is a drop-in substitute for `docker build`/`docker
run`/`docker exec` (same flags, verified working end to end including real
device passthrough, on a real Fedora host) — see the rootless-podman caveat
under Troubleshooting near the end of this doc if you're not running a
root-daemon setup. `podman compose` additionally requires installing
`podman-compose` separately (unlike Docker, where `docker compose` ships
built in) — if you don't have it, use Option 2 (plain run) with `podman`
instead of Option 1.

**Feature gap:** the video-source feature requires the Electron desktop
app as the camera capture origin — a headless deployment has no video
source. Everything else (rig control, audio, CW keyer, CW decode,
spectrum, spots, solar data, admin panel) works exactly as in the desktop
app, viewed from any browser pointed at the controller's IP.

**Platform support:** **x64** (N100/N150 mini PCs and any other x86_64 Linux box) and **arm64** (Raspberry Pi 3/4/5 running a 64-bit OS) are both supported for the bare-metal tarball and systemd install. The Docker image is currently **`linux/amd64` only** — on a Raspberry Pi, use the arm64 tarball (see the systemd section below).

---

## Image runtime dependencies

Both build stages pin `ubuntu:24.04` rather than a Debian-based Node
image, for the same glibc-2.39 floor rationale as the DEB/RPM packages
(see [linux-packages.md](linux-packages.md)). The runtime stage's `apt-get
install` list is a trimmed subset of the DEB/RPM `depends` lists in
`package.json` — it drops the Electron/Chromium-only GUI libs (GTK3, NSS,
X11 libs, etc.) a headless deployment never loads, but otherwise needs the
same libraries for the same reasons (PortAudio/naudiodon, `rigctld`, the
FT4222 reader). Two things aren't obvious from the package names alone:

- **`libpulse0`** is required even though naudiodon's actual I/O path is
  ALSA/PipeWire — its prebuilt `libportaudio.so.2` dynamically links
  `libpulse.so.0` and fails to import without it.
- **`libasound2t64`/`libreadline8t64`**, not `libasound2`/`libreadline8`:
  Ubuntu 24.04's 64-bit `time_t` transition left the old names as
  ambiguous virtual packages with no installable candidate — `apt-get
  install` needs the real `t64`-suffixed names directly. This only
  affects a direct `apt-get install` like the Dockerfile's; electron-builder's
  `.deb` `Depends: libasound2` field resolves fine via apt's `Provides`
  mechanism, which is why `test-linux-packages.sh` never catches this
  class of naming mismatch.

---

## Why host networking?

The Hamlib UDP spectrum source (`spectrumSettings.source === "hamlib"`)
receives a **multicast** UDP stream from `rigctld`. Docker's default
bridge network mode puts the container behind a NAT'd virtual interface
that LAN multicast traffic generally can't reach — so in bridge mode, the
Hamlib UDP spectrum panel would just go dead with no obvious error, while
everything else kept working fine. Host networking (`network_mode: host`)
avoids this by giving the container the host's real network stack, so
multicast reception works exactly as it would running `node server.ts`
directly. The cost — losing Docker's port isolation — doesn't matter on a
box dedicated to this one job. If you know you'll only ever use the FT4222
or Audio I/Q spectrum sources (neither uses multicast), bridge mode with
explicit `-p 3000:3000` port mapping works fine too.

---

## Device access

**Group GIDs matter — don't use group names, use numbers.** The non-root
container user reaches `/dev/ttyUSB0`/`/dev/snd` via `--group-add
dialout --group-add audio`, but Docker/Podman resolve those *names*
against `/etc/group` **inside the image**, not the host. The image (built
from `ubuntu:24.04`) bakes in `dialout=20`, `audio=29` — real hosts
commonly use different values (confirmed on a real Ubuntu 24.04 test
host: `dialout=18`, `audio=63`). Using the names silently grants the
*wrong* GIDs and device access fails with no obvious error. Always look
up your actual host GIDs and pass them as numbers:

```bash
getent group dialout audio | awk -F: '{print $1"="$3}'
```

`docker-compose.yml` reads these from `DIALOUT_GID`/`AUDIO_GID` environment
variables (export them or put them in a `.env` file next to the compose
file) rather than hardcoding names.

### Serial (CAT control)

Find your radio's stable device path (this survives reboots and USB
replugging, unlike `/dev/ttyUSB0`, which can shift):

```bash
ls -l /dev/serial/by-id/
```

Use that path in place of `/dev/ttyUSB0` below.

**CW keying on a second serial port:** some setups need DTR/RTS keying on
a serial port distinct from CAT control — e.g. the IC-7300's single-port
conflict (see Known Issues in `CLAUDE.md`), or any radio wired to a second
USB-serial adapter for its key jack. This is a separate `docker-compose.yml`
line (commented out by default, tagged "CW keying"), governed by the same
`dialout` group already granted above — no extra config beyond adding the
line and pointing the app's Settings → KEYER → Keyer Port at the matching
in-container path. Verified against a real dual-port CP2105 adapter during
development.

### Audio (radio's USB sound card)

Pass through the whole ALSA subsystem (`/dev/snd`) rather than a specific
`hw:X,Y` device — the card index isn't stable either. This is actually
*more* reliable than a typical desktop install: the documented "PipeWire
doesn't reconnect after a radio power cycle" issue only exists because a
desktop-session PipeWire daemon is running and re-targets its default
device when the USB audio interface disappears and reappears. A headless
controller has no desktop session and no PipeWire running at all, so raw
ALSA passthrough sidesteps that whole problem.

**`/dev/snd` alone is not enough — `/proc/asound` also needs unmasking.**
Docker and Podman mask `/proc/asound` inside every container by default,
regardless of what device nodes you pass through via `devices:` — this is
deliberate security hardening (an unmasked `/proc/asound` can leak the
*host's* audio playback/recording activity to the container; see
[containerd's fix](https://github.com/containerd/containerd/commit/703786c5c9fa607a511c1c1a5773d761eb8bb1ae)).
naudiodon's PortAudio ALSA backend enumerates sound cards by reading
`/proc/asound`, not just by opening `/dev/snd/controlC*` directly, so with
the mask in place the Audio Backend's Input/Output dropdowns stay empty
even though `/dev/snd`'s device nodes are present and correctly
permissioned ([issue #55](https://github.com/jbdubbs/Rig-Control-Web/issues/55) —
confirmed by reproducing it against real ALSA hardware, both containerized
and bare-metal).

The fix — already included by default in `docker-compose.yml` — is
`security_opt: systempaths=unconfined`:

```yaml
security_opt:
  - systempaths=unconfined
```

**A plain bind mount of `/proc/asound` (`-v /proc/asound:/proc/asound:ro`)
looks like the more surgical fix, but does not actually work** on current
Docker: `runc`'s "proc-safety" hardening outright rejects any bind mount
whose *target* is a path inside `/proc`, regardless of source or intent —
confirmed against `runc` 1.4.3 / Docker 29.7.2, which fails container
startup with `... cannot be mounted because it is inside /proc`. This is a
newer, stricter check than the masking itself and applies even to a
read-only mount of a real host path. `systempaths=unconfined` un-masks
*every* default-masked path (not just `/proc/asound` — also things like
`/proc/acpi`, `/proc/scsi`, `/proc/keys`), which is blunter than ideal, but
it's the only approach confirmed working on both Docker and Podman.

### FT4222 (FT-710 spectrum scope)

Verified working end to end against a real FT-710 during development —
harder to set up than serial or audio, but reliable once configured. Three
things beyond serial/audio, all pre-written (commented out) in
`docker-compose.yml` — uncomment every line tagged "FT4222" there:

1. **Install `libft4222` on the host first**, following
   [`docs/ft4222-spectrum-setup.md`](ft4222-spectrum-setup.md) — FTDI
   doesn't distribute it through any Linux package manager, only a direct
   download from ftdi.com. It's deliberately **not** baked into the
   published image: doing so would mean redistributing FTDI's proprietary
   SDK binary through a public Docker Hub image, which its license doesn't
   clearly permit. `docker-compose.yml` instead bind-mounts your own,
   already-licensed host installation (the whole `/usr/local/lib`
   directory, not a specific filename, since the exact patch version
   varies by what you downloaded).
2. **The whole USB bus**, not a specific device path — the FT4222 library
   enumerates devices itself by VID:PID rather than opening a fixed path,
   and bus/device numbers renumber on replug/reboot anyway. Needs both the
   bind mount and a cgroup rule granting the USB device class (a separate
   permission layer from file mode bits):
   ```yaml
   devices:
     - /dev/bus/usb:/dev/bus/usb
   device_cgroup_rules:
     - "c 189:* rmw"
   ```
   The host's udev rules from `docs/ft4222-spectrum-setup.md` (the
   `uaccess`/`dialout` group grant) still govern access even through a
   bind mount — same as running on bare metal.
3. **`LD_LIBRARY_PATH=/usr/local/lib`** — required because `dlopen()`
   needs it: the image's `ld.so.cache` was built without `libft4222` (it
   only exists via the runtime bind mount), so the bare
   `dlopen("libft4222.so")` call in `ft4222-scope-reader.c` wouldn't
   otherwise find it.

The systemd deployment remains slightly simpler for FT4222 specifically
(no bus-renumbering or library-mounting considerations, since it's just
running on the host directly) — but Docker is a fully supported, verified
option too, not a fallback.

---

## Option 1: Docker Compose (recommended)

1. Install Docker (`docker` + the `docker compose` plugin — most current
   distro packages bundle both).
2. Download `docker-compose.yml` from the repo (or clone it):
   ```bash
   curl -O https://raw.githubusercontent.com/jbdubbs/Rig-Control-Web/main/docker-compose.yml
   ```
3. Edit the serial device line to match your radio (see "Serial" above).
4. Look up and export this host's real `dialout`/`audio` GIDs (see
   "Device access" above — don't skip this, the defaults will not match):
   ```bash
   export DIALOUT_GID=$(getent group dialout | cut -d: -f3)
   export AUDIO_GID=$(getent group audio | cut -d: -f3)
   ```
5. Start it:
   ```bash
   docker compose up -d
   ```
6. Browse to `https://<controller-ip>:3000` — the self-signed certificate
   will prompt a browser warning the first time; this is normal and
   expected (the certificate is self-generated for encryption, not issued
   by a trusted authority). Log in as `ADMIN` / `admin`; you'll be forced
   to set a new password on first login.
7. To update: `docker compose pull && docker compose up -d`.

Settings, user accounts, and TLS certs persist in the `rcw-data` named
volume across restarts/upgrades.

## Option 2: Plain `docker run`

```bash
docker run -d \
  --name rigcontrol-web \
  --restart unless-stopped \
  --network host \
  --group-add "$(getent group dialout | cut -d: -f3)" \
  --group-add "$(getent group audio | cut -d: -f3)" \
  --device /dev/serial/by-id/usb-REPLACE_ME:/dev/ttyUSB0 \
  --device /dev/snd:/dev/snd \
  --security-opt systempaths=unconfined \
  -e RCW_DATA_DIR=/data \
  -v rcw-data:/data \
  jbdubbs/rigcontrol-web:latest
```

`--security-opt systempaths=unconfined` is required alongside `--device
/dev/snd` — see the "Audio" note under "Device access" above for why (a
`-v /proc/asound:/proc/asound:ro` bind mount looks more targeted but is
rejected outright by current Docker).

## Option 3: systemd (no container runtime, no build tools)

For a box where you'd rather not run Docker at all. Download the prebuilt
x86-64 tarball from the
[latest release](https://github.com/jbdubbs/Rig-Control-Web/releases/latest)
(`rigcontrol-web-<version>-linux-x64.tar.gz`) — it ships `node_modules`
already compiled against this project's Ubuntu 24.04 / glibc 2.39 floor
(see `scripts/build-headless-x64.sh`), so **no compiler or build tools are
needed on the target machine** (this replaces the old `git clone && npm
ci` flow — see [issue #57](https://github.com/jbdubbs/Rig-Control-Web/issues/57)):

```bash
# Node.js 24 runtime (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash - && sudo apt-get install -y nodejs
# Node.js 24 runtime (Fedora/RHEL-family) — instead of the line above:
#   sudo dnf module install -y nodejs:24

# Runtime shared libraries naudiodon/rigctld/the FT4222 reader need
# (Debian/Ubuntu; see "Image runtime dependencies" above for why each one
# is needed — this is the same list, minus the GUI-only packages):
sudo apt-get install -y --no-install-recommends \
  ca-certificates libasound2t64 libpulse0 libusb-1.0-0 libreadline8t64 libportaudio2 libuuid1
# Fedora/RHEL-family equivalent instead of the line above:
#   sudo dnf install -y ca-certificates alsa-lib pulseaudio-libs libusb1 readline libuuid

sudo useradd --system --home /opt/rigcontrol-web --shell /usr/sbin/nologin \
  --groups dialout,audio rigcontrol-web
sudo tar xzf rigcontrol-web-<version>-linux-x64.tar.gz -C /opt --strip-components=1 --one-top-level=rigcontrol-web
sudo chown -R rigcontrol-web:rigcontrol-web /opt/rigcontrol-web
sudo mkdir -p /var/lib/rigcontrol-web
sudo chown rigcontrol-web:rigcontrol-web /var/lib/rigcontrol-web
sudo cp /opt/rigcontrol-web/rigcontrol-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rigcontrol-web
```

Check status/logs with `systemctl status rigcontrol-web` /
`journalctl -u rigcontrol-web -f`.

#### Raspberry Pi (arm64)

The Releases page also carries an arm64 tarball
(`rigcontrol-web-<version>-linux-arm64.tar.gz`) for Raspberry Pi 3/4/5
running 64-bit Raspberry Pi OS (Bookworm or later) or Debian 13. It is built
against a Debian 12 glibc floor (2.36), and like the x64 tarball ships
`node_modules` and all helper binaries prebuilt, so no compiler is needed on
the Pi. The install steps are the same as above with the `linux-arm64`
filename, except the runtime library package names are the plain (non-`t64`)
Debian 12 ones (`libasound2`, `libreadline8`); on Debian 13 keep the `t64` names shown above.

### Building from source instead

If you'd rather build it yourself (e.g. to run off a modified checkout):

```bash
sudo useradd --system --home /opt/rigcontrol-web --shell /usr/sbin/nologin \
  --groups dialout,audio rigcontrol-web
sudo git clone https://github.com/jbdubbs/Rig-Control-Web.git /opt/rigcontrol-web
sudo chown -R rigcontrol-web:rigcontrol-web /opt/rigcontrol-web

# Build as the unprivileged service user, not root — npm install/build
# scripts (node-gyp rebuilds for naudiodon/libopus-node, etc.) run
# arbitrary code and shouldn't do so with root privileges.
sudo -u rigcontrol-web bash -c 'cd /opt/rigcontrol-web && npm ci && npm run build'

sudo mkdir -p /var/lib/rigcontrol-web
sudo chown rigcontrol-web:rigcontrol-web /var/lib/rigcontrol-web

# Install and start the service
sudo cp docs/rigcontrol-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rigcontrol-web
```

Requires Node 24+ (same NodeSource/`dnf module install` commands as
above) and the same system packages as building from source on Linux
(`libasound2-dev libopus-dev build-essential`, plus `gcc` to compile
`cw-key-helper`/`ft4222-scope-reader` if you need them —
`bin/linux/rigctld` and the other helpers are already committed in the
repo for x64, so this is usually just `npm ci && npm run build`).

---

## Troubleshooting: rootless Docker/Podman and device access

If you're running **rootless** Docker or Podman (increasingly the default
on security-conscious distros — not the standard `docker.io`/`docker-ce`
root-daemon install), device passthrough for serial/audio can fail even
with the correct numeric GIDs from the "Device access" section above.
This is a Linux user-namespace limitation, not specific to this image:
rootless containers can only represent host GIDs that fall inside the
container engine's delegated `/etc/subgid` range, and low "system" GIDs
like `dialout`/`audio` normally don't. Symptoms: `Permission denied`
reading/writing the device even though `id` inside the container shows
the right supplementary group numbers.

Things to try, roughly in order of how likely they are to help:

1. Run as `root` (rootless-mode "root" is still confined to your own user's
   privileges on the host, so this is not the same risk as `root` under a
   root-daemon install) — sometimes sufficient, but not guaranteed to fix
   arbitrary GID access.
2. Podman's rootless-specific escape hatch:
   `--userns=keep-id --user "$(id -u):$(id -g)" --group-add keep-groups`
   — intended to preserve your invoking host user's real supplementary
   groups inside the container. Whether this actually grants access
   depends on your kernel/crun/podman version; it did not resolve the
   issue in one tested rootless environment, so treat it as worth trying,
   not a guaranteed fix.
3. **Most reliable, and confirmed working:** use a standard root-daemon
   Docker install (`docker.io` / `docker-ce`, the default on most distros)
   rather than rootless mode. Without user-namespace remapping, numeric
   `--group-add` works exactly as documented above with no further
   workarounds needed — verified end to end (real serial + audio device
   read/write access) on a real Fedora host during this feature's
   development. This is the setup a dedicated Pi/mini-PC controller would
   typically run.

## Firewall

Open TCP 3000 (HTTPS) inbound from your LAN. If you use the Hamlib UDP
spectrum source, also confirm UDP traffic on your multicast port (default
4531) isn't blocked between `rigctld`'s host and this box, if they're
different machines.
