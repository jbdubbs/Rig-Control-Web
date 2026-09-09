# RigControl Web (Headless)

Open-source web app for controlling amateur radio equipment via [Hamlib](https://github.com/Hamlib/Hamlib). This image runs the **headless backend only** (no Electron/GUI, no video-source feature) — a good fit for a dedicated radio-controller box (x64 mini PC, N100/N150, an old laptop, a NAS) running in the shack, controlled remotely from any browser.

Full-featured desktop builds (Windows/macOS/Linux, with the video feed) are on the [GitHub Releases page](https://github.com/jbdubbs/Rig-Control-Web/releases).

**Latest release: v1.4.1** (headless-only patch release, no desktop/Electron changes) — fixes the remaining half of issue #55: `naudiodon`/PortAudio was aborting *all* audio device enumeration if even one unrelated host API (eg. PulseAudio) failed to initialize, which happens by design in a minimal container with no PipeWire/PulseAudio session — even when the actual radio's ALSA audio interface was present and working fine. See the [full release notes](https://github.com/jbdubbs/Rig-Control-Web/releases/tag/v1.4.1) for details.

## Quick start (Docker Compose)

```bash
curl -O https://raw.githubusercontent.com/jbdubbs/Rig-Control-Web/main/docker-compose.yml
export DIALOUT_GID=$(getent group dialout | cut -d: -f3)
export AUDIO_GID=$(getent group audio | cut -d: -f3)
# edit the serial device line in docker-compose.yml to match your radio, then:
docker compose up -d
```

Browse to `https://<controller-ip>:3000` and log in as `ADMIN` / `admin` (forced password change on first login).

Tags: `latest` and version-pinned (e.g. `1.4.1`). `linux/amd64` only for now — ARM64/Raspberry Pi is intentionally deferred until the amd64 image gets more real-world usage reports.

## Full documentation

- [Headless Deployment guide](https://github.com/jbdubbs/Rig-Control-Web/wiki/Headless-Deployment) — device access (serial/audio/FT4222), `docker run`, systemd, rootless-container caveats, firewall
- [Wiki](https://github.com/jbdubbs/Rig-Control-Web/wiki) — full user guide
- [Source / issues](https://github.com/jbdubbs/Rig-Control-Web)
