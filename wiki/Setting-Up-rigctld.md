# Setting Up rigctld

Before RigControl Web can talk to your radio, it needs a program called `rigctld` running in the background. Think of `rigctld` as a translator — it speaks your radio's language over the USB or serial cable, and lets RigControl Web (and any other Hamlib-compatible logging software) talk to it over a simple network connection on your computer.

This page walks you through configuring and starting `rigctld` from inside the app.

---

## Opening General Settings

Click the **gear icon** (⚙) in the top-right corner of the app to open **General Settings**. The settings panel has two tabs: **RIGCTLD** and **SPOTS**. Make sure you are on the **RIGCTLD** tab.

![RigControl Web — rigctld Settings](https://raw.githubusercontent.com/jbdubbs/Rig-Control-Web/main/assets/rigcontrolweb.manual.rigctld.settings.png)

---

## Understanding the Two Sections

The RIGCTLD tab is divided into two sections with different background colors:

- **Client Side Settings** (green heading) — These control how the *app* connects to `rigctld`. In almost all cases you can leave these at their defaults.
- **Server Side / Backend Settings** (blue heading) — These control how `rigctld` connects to your *radio*. You will need to fill these in for your specific radio and computer.

---

## Client Side Settings

These settings tell the app where to find the running `rigctld` process.

| Field | What it does | Default |
|-------|-------------|---------|
| **Host Address** | The address where `rigctld` is running. Use `127.0.0.1` if it's on the same computer as the app. | `127.0.0.1` |
| **Port** | The network port `rigctld` listens on. | `4532` |
| **Poll Rate** | How often the app asks the radio for its current frequency, mode, and meter readings. Lower values feel more responsive but put more load on the radio's serial connection. 1000–1500 ms is a good starting point for most radios. | `1500 ms` |

> **Note for advanced users:** If you are running `rigctld` on a separate computer (for example, a headless server in your shack), enter that computer's IP address in the Host Address field here.

---

## Server Side / Backend Settings

These settings are passed directly to `rigctld` when the app starts it. You must configure these correctly for your radio.

| Field | What it does | Example |
|-------|-------------|---------|
| **Rig Model** | Your radio's Hamlib model number. Use the dropdown to search by manufacturer and model name. | `1049: Yaesu FT-710` |
| **Serial Port** | The serial or USB port your radio's CAT cable is connected to. On Linux this looks like `/dev/ttyUSB0` or `/dev/serial/by-id/...`. On Windows it looks like `COM3`. | `/dev/ttyUSB0` |
| **Server Port** | The port `rigctld` will listen on. Should match the Port in Client Side Settings above. | `4532` |
| **Serial Speed** | The baud rate (communication speed) for your radio's CAT connection. Check your radio's manual for the correct value. Common values are `9600`, `19200`, and `38400`. | `38400` |
| **Listen Address** | The network address `rigctld` will accept connections from. Leave this at `127.0.0.1` for local use only. To accept connections from other computers on your network, change this to `0.0.0.0`. | `127.0.0.1` |

> **Finding your serial port on Linux:** Open a terminal and run `ls /dev/serial/by-id/` after connecting your radio. The full path shown there can be pasted directly into the Serial Port field — it is more reliable than `/dev/ttyUSB0` because it stays consistent even if you have other USB devices connected.

> **Finding your serial port on Windows:** Open Device Manager and look under "Ports (COM & LPT)" with your radio connected.

---

## Starting rigctld

Once your settings are filled in, scroll down to the bottom of the RIGCTLD tab. You will see a status bar with **Test**, **Start**, and **Stop** buttons.

- **Test** — Checks whether `rigctld` can be found on your system and verifies your settings without actually starting it. Run this first if you are unsure. A "Test Passed" message means everything looks good.
- **Start** — Starts `rigctld` with your settings. The status indicator will turn green and show **RUNNING** when it is up.
- **Stop** — Stops the running `rigctld` process.

> **Auto-start:** RigControl Web remembers whether `rigctld` was running when you last closed the app. If it was running, it will start it automatically next time you launch. If you stopped it before closing, it will not auto-start.

---

## Process Logs

Below the Start/Stop controls is a **Process Logs** panel. This shows the last 100 lines of output from `rigctld`. If something is not working — for example, the app cannot connect to your radio — this is the first place to look. Common messages you might see:

- `rigctld: rig opened successfully` — Everything is working.
- `error opening port` — The Serial Port field is wrong, or the radio is not plugged in.
- `bind: Address already in use` — Something else (another copy of `rigctld`, a logging program) is already using port 4532. See the section below.

---

## Port Conflicts

If `rigctld` is already running on your computer from another program (WSJT-X, for example), the Start button will show an error and the status will display **ALREADY RUNNING**. You have two options:

1. **Stop the other program** and then click Start.
2. Click **Kill and Restart** — this forcibly stops any existing `rigctld` process and starts a fresh one with your current settings. Use this with caution if other programs are actively using `rigctld`.

---

## Using rigctld With Other Software

Because `rigctld` exposes a standard network interface, you can configure any Hamlib-compatible logging or digital mode program to connect to it alongside RigControl Web. In programs like WSJT-X, FLDigi, VarAC, or JS8Call, choose **Hamlib NET rigctl** as the rig type and set the network address to `127.0.0.1:4532`. All programs will share the same radio connection without needing separate serial port splitters.
