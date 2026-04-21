# RigControl Web — User Guide

RigControl Web is a radio control dashboard that runs in any web browser. It connects to your radio through Hamlib's `rigctld` program, giving you real-time frequency and mode display, one-click tuning, transmit and receive audio over the network, a live video feed of your radio's front panel, and live spot displays for Parks on the Air (POTA) and Summits on the Air (SOTA).

Whether you are sitting at your shack computer or connecting from a phone, tablet, or laptop across the room (or across the country over a VPN), the interface adapts to your screen size automatically.

---

## Who This Guide Is For

This guide assumes you are a licensed amateur radio operator who is comfortable installing software and knows the basics of your radio — things like serial ports, baud rates, and VFOs. You do not need to be a programmer or network engineer.

---

## Installation

For most users, the right way to get started is to **download a pre-built installer from the [GitHub Releases page](https://github.com/jbdubbs/Rig-Control-Web/releases)**. Pick the installer for your operating system (Windows or Linux), run it, and you are ready to go. You do not need to install Node.js, build anything from source, or touch a command line.

Developers and advanced users who want to run from source can find instructions in the project [README](https://github.com/jbdubbs/Rig-Control-Web/blob/main/README.md).

> **Linux users:** The Linux release bundles Hamlib — no separate Hamlib install is needed.
> **Windows users:** Hamlib 4.7.0 or later must be installed separately. See the [README](https://github.com/jbdubbs/Rig-Control-Web/blob/main/README.md) for download links.

---

## Screen Layouts

RigControl Web automatically switches between three layouts based on the width of your browser window or device screen:

| Layout | When it appears |
|--------|----------------|
| **Phone** | Screen narrower than 768 pixels — portrait phones and small tablets |
| **Compact** | Screen between 768 and 1279 pixels — landscape phones, tablets, smaller desktop windows |
| **Desktop** | Screen 1280 pixels or wider — full desktop or laptop |

All three layouts show the same information and controls, just arranged differently for the available space.

---

## Guide Sections

- [Setting Up rigctld](Setting-Up-rigctld) — Configure your radio connection and start the control process
- [Connecting the Local Client](Connecting-the-Local-Client) — Connect to your rig and understand the status display
- [Controls](Controls) — VFO, mode, meters, PTT, and radio function buttons
- [Audio and Video](Audio-and-Video) — Set up the audio feed and video display
- [Remote Access](Remote-Access) — Connect from another device over your network or VPN
- [POTA and SOTA Spots](POTA-and-SOTA-Spots) — Live activator spots with click-to-tune
