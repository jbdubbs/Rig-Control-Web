# RigControl Web — User Guide

RigControl Web is a radio control dashboard that runs in any web browser. It connects to your radio through Hamlib's `rigctld` program, giving you real-time frequency and mode display, one-click tuning, transmit and receive audio over the network, a live video feed of your radio's front panel, a full iambic CW keyer with local sidetone, live spot displays for Parks on the Air (POTA), Summits on the Air (SOTA), World Wide Flora & Fauna (WWFF), and a live DX Cluster feed, a built-in FT8 decoder and CW decoder, an audio waterfall, and solar/propagation data with a live MUF world map. Access requires a login — every user has their own account and the server includes a full admin panel for user management.

Whether you are sitting at your shack computer or connecting from a phone, tablet, or laptop across the room (or across the country over a VPN), the interface adapts to your screen size automatically.

---

## Who This Guide Is For

This guide assumes you are a licensed amateur radio operator who is comfortable installing software and knows the basics of your radio — things like serial ports, baud rates, and VFOs. You do not need to be a programmer or network engineer.

---

## Installation

For most users, the right way to get started is to **download a pre-built installer from the [GitHub Releases page](https://github.com/jbdubbs/Rig-Control-Web/releases)**. Pick the installer for your operating system (Windows, macOS, or Linux), run it, and you are ready to go. You do not need to install Node.js, build anything from source, or touch a command line.

**Running on a dedicated Raspberry Pi or mini PC instead?** See [Headless Deployment](Headless-Deployment) for Docker Compose, `docker run`, and systemd options — no display or Electron required.

**Installing the Linux DEB/RPM package?** See [Linux DEB & RPM Packages](Linux-Packages) for supported distros and dependency details.

Developers and advanced users who want to run from source can find instructions in the project [README](https://github.com/jbdubbs/Rig-Control-Web/blob/main/README.md).

> **Linux users:** The Linux release bundles Hamlib — no separate Hamlib install is needed.
> **Windows users:** Hamlib 4.7.0 or later must be installed separately. See the [README](https://github.com/jbdubbs/Rig-Control-Web/blob/main/README.md) for download links.

---

## Screen Layouts

RigControl Web automatically switches between two layouts based on the width of your browser window or device screen:

| Layout | When it appears |
|--------|----------------|
| **Phone** | Screen narrower than 768 pixels — portrait phones and small tablets |
| **Compact** | Screen 768 pixels or wider — landscape phones, tablets, and desktop windows |

Both layouts show the same information and controls, just arranged differently for the available space. On the phone layout, a hamburger menu in the header holds Connect, Settings, layout Edit, Log out, and a **Full Screen** toggle that also keeps the screen awake.

---

## Guide Sections

- [Authentication](Authentication) — Login, user accounts, roles, and the admin panel
- [Setting Up rigctld](Setting-Up-rigctld) — Configure your radio connection and start the control process
- [Hamlib UDP Spectrum Scope](Spectrum-Scope-Hamlib-UDP) — Live panadapter for IC-7300, IC-7300MK2, IC-7610, IC-7850/7851, IC-705, IC-9700, and IC-905
- [FT-710 Spectrum Scope Setup](Spectrum-Scope-FT-710) — Live panadapter for the Yaesu FT-710 via USB
- [Audio I/Q Spectrum Scope Setup](Spectrum-Scope-Audio-IQ) — Live panadapter from a radio's baseband I/Q output via a USB audio interface (tested on the Xiegu G90)
- [Connecting the Local Client](Connecting-the-Local-Client) — Connect to your rig and understand the status display
- [Controls](Controls) — VFO, mode, meters, PTT, radio power on/off, radio function buttons, and the CW and FT8 decoders
- [CW Keying Setup](CW-Keying-Setup) — Get your radio actually transmitting CW from the keyer (radio menu settings and troubleshooting)
- [Audio and Video](Audio-and-Video) — Set up the audio feed, the Audio Waterfall, and the video display
- [Remote Access](Remote-Access) — Connect from another device over your network or VPN
- [POTA, SOTA, and WWFF Spots](POTA-and-SOTA-Spots) — Live activator spots with click-to-tune
- [DX Cluster Spotting](DX-Cluster-Spotting) — Live telnet DX Cluster feed with callsign/prefix and keyword filtering for hunting specific stations or regions
- [Solar and Propagation](Solar-and-Propagation) — HF/VHF band conditions, solar indices, and the MUF world map
- [WSJTX Integration](WSJTX-Integration) — Use WSJTX for FT8, FT4, and other digital modes via the wsjtx-bridge helper
- [Diagnostic Logging](Diagnostic-Logging) — Capture debug output for troubleshooting and bug reports
- [Headless Deployment](Headless-Deployment) — Run on a dedicated Raspberry Pi (arm64) or mini PC (x64) via Docker or systemd, no display required
- [Linux DEB & RPM Packages](Linux-Packages) — Supported distros, dependencies, and installation instructions for the native Linux packages
