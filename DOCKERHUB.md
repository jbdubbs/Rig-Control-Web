# RigControl Web (Headless)

Open-source web app for controlling amateur radio equipment via [Hamlib](https://github.com/Hamlib/Hamlib). This image runs the **headless backend only** (no Electron/GUI, no video-source feature) — a good fit for a dedicated radio-controller box (x64 mini PC, N100/N150, an old laptop, a NAS) running in the shack, controlled remotely from any browser.

Full-featured desktop builds (Windows/macOS/Linux, with the video feed) are on the [GitHub Releases page](https://github.com/jbdubbs/Rig-Control-Web/releases).

**Latest release: v1.4.0** — adds a DX Cluster spotting tab, a searchable Rig Model dropdown, and Serial Port fields that auto-populate with detected devices. Fixes a headless Docker/Podman audio device-enumeration bug (issue #55) and a segfault from rapid backend-audio device restarts (issue #53). See the [full release notes](https://github.com/jbdubbs/Rig-Control-Web/releases/tag/v1.4.0) for everything else included.

## Quick start (Docker Compose)

```bash
curl -O https://raw.githubusercontent.com/jbdubbs/Rig-Control-Web/main/docker-compose.yml
export DIALOUT_GID=$(getent group dialout | cut -d: -f3)
export AUDIO_GID=$(getent group audio | cut -d: -f3)
# edit the serial device line in docker-compose.yml to match your radio, then:
docker compose up -d
```

Browse to `https://<controller-ip>:3000` and log in as `ADMIN` / `admin` (forced password change on first login).

Tags: `latest` and version-pinned (e.g. `1.4.0`). `linux/amd64` only for now — ARM64/Raspberry Pi is intentionally deferred until the amd64 image gets more real-world usage reports.

## Full documentation

- [Headless Deployment guide](https://github.com/jbdubbs/Rig-Control-Web/wiki/Headless-Deployment) — device access (serial/audio/FT4222), `docker run`, systemd, rootless-container caveats, firewall
- [Wiki](https://github.com/jbdubbs/Rig-Control-Web/wiki) — full user guide
- [Source / issues](https://github.com/jbdubbs/Rig-Control-Web)
