# DX Cluster Spotting

RigControl Web can connect to a live **DX Cluster** — the decades-old amateur radio network where operators post real-time "I just worked/heard this station" spots — and display them in a filterable, click-to-tune table. This is a different kind of spotting than [POTA, SOTA, and WWFF](POTA-and-SOTA-Spots): those show activator traffic from specific award programs, while DX Cluster spots cover *any* station anyone on the network has bothered to post, worldwide, on any band or mode. Because that firehose is much bigger and less targeted than POTA/SOTA/WWFF, the DX tab is built around **finding specific stations or regions**, not browsing everybody.

---

## How It's Different From POTA/SOTA/WWFF

POTA, SOTA, and WWFF spots come from simple public web APIs that your browser polls directly. DX Cluster spots don't work that way — there's no public web API for them. The real DX Cluster network is a **telnet-based** system (the same technology it's used since the 1990s), so RigControl Web's server itself opens a persistent, logged-in connection to a cluster node and relays spots to your browser(s) over the existing WebSocket connection.

Two practical consequences of this:

- **You need a callsign to log in.** Cluster nodes require a callsign at login (no password) — this is normal cluster etiquette, not a RigControl Web requirement.
- **The connection is shared, not per-browser-tab.** Unlike POTA/SOTA/WWFF, where every open browser tab independently fetches its own copy, the DX Cluster connection is a single connection owned by the RigControl Web server. If you have the app open on your phone and your desktop at the same time, both see spots from that one shared connection — which is also exactly why the app is careful about not hammering the cluster node with repeated reconnects (see [Rate Limiting](#rate-limiting-and-connection-behavior) below).

---

## Adding a DX Cluster Panel

Click **Edit** to enter layout edit mode, then **Add Panel** and choose:

- **DX Cluster** — a standalone panel showing only DX Cluster spots
- **All Spots** — the combined panel with POTA, SOTA, WWFF, and a **DX** tab together in one tabbed view

Either way, the panel does nothing until you enable the connection in its settings — placing the panel doesn't automatically start connecting (unlike POTA/SOTA/WWFF, which start fetching as soon as their panel is placed).

---

## Settings

Click the gear icon (⚙) in the DX Cluster panel's header (or the **DX** tab of the All Spots panel's settings) to open its settings.

### Enable DX Cluster

Off by default. Turning this on tells the server to open the telnet connection using the host, port, and callsign configured below. The status line under the toggle shows **Connected**, **Connecting…**, an error message, or **Disabled**.

### Cluster Host / Port

The DX Cluster node to connect to. Defaults to **w3lpl.net:7373** (W3LPL, a well-known high-volume public node near Glenwood, MD, running DXSpider). You can point this at any other public DXSpider or AR-Cluster telnet node — see [ng3k.com's cluster list](https://www.ng3k.com/Misc/cluster.html) for alternatives if you want one geographically closer to you, or one with different default filtering (e.g. RBN/skimmer spots on or off).

### Login Callsign

Pre-filled with your account's callsign the first time you open settings. This is sent as your login identity when the connection is established — most public nodes don't check it against a database, but send your real callsign as a courtesy to the node's sysop.

### Max Spot Age

How long a spot stays in the table before aging out: 5, 10, 15, 30, or 60 minutes.

### Callsign / Prefix Filter

A comma-separated list of callsigns or prefixes to watch for, e.g. `VP8, FT5, JA1ABC`. A spot is shown if the DX station's callsign *contains* any one of the listed terms (case-insensitive). Leave empty to show every callsign.

This doubles as a geographic filter — since amateur radio callsign prefixes map to countries/regions (e.g. `VP8` = Falkland Islands, `9M2` = West Malaysia, `JA` = Japan), filtering by prefix is the standard way DX cluster users have always narrowed spots to a region of interest, without needing a separate country lookup.

### Keyword Filter

A comma-separated list of keywords to match against the spot's **comment** text, e.g. `FT8, CONTEST`. Spotters often type useful context into the comment (mode, "CQ", "UP 2", a contest name), so this is the way to filter by mode or activity type — DX Cluster spot lines don't have a dedicated mode field the way POTA/SOTA/WWFF spots do.

### Band Filter

Same as the POTA/SOTA/WWFF band filter — check the bands you're interested in, or leave all unchecked to show every band.

Callsign and keyword filters are combined with **AND** (a spot must satisfy both, if both are set); terms within a single filter are combined with **OR** (any one match is enough).

---

## Reading the Spots Table

| Column | What it shows |
|--------|--------------|
| **DX** | The callsign of the station being spotted |
| **Frequency** | The frequency in MHz — click to tune |
| **Spotter** | The callsign of the station that posted the spot |
| **Comment** | Free-text comment from the spotter (mode, signal report, "CQ", etc.) |
| **Age** | How long ago this spot was posted |

Click any column header to sort by it; click again to reverse, a third click returns to arrival order.

---

## Click-to-Tune

Click a spot's frequency to tune your radio there. Because DX Cluster spots don't carry a structured mode field, RigControl Web scans the comment text for a recognizable mode keyword (`FT8`, `FT4`, `CW`, `SSB`/`USB`/`LSB`) and switches mode only if it finds one — if the comment doesn't mention a mode, only the frequency changes and your current mode is left alone, rather than guessing wrong and silently changing it.

As with the other spot panels, you must be connected to your rig for click-to-tune to work.

---

## Rate Limiting and Connection Behavior

Public DX Cluster nodes are shared resources run by volunteer sysops, and reconnecting to one rapidly and repeatedly is considered abusive — it can get the connecting IP banned from the node. To avoid that, RigControl Web caps connection attempts to **3 per rolling 60-second window**, 10 seconds apart. If all 3 attempts fail (bad host/port, node down, network issue), the connection gives up and shows an error — you'll need to **disable and re-enable** DX Cluster in settings to get a fresh attempt budget. A successful login resets the budget immediately, so a connection that's been up for a while and drops later isn't penalized by attempts spent getting established.

Settings changes only restart the connection when something connection-relevant actually changes (host, port, login callsign, or the enable toggle itself) — editing the max age or a filter never bounces the connection.

---

## Troubleshooting

### Connection Shows "Gave up after 3 connection attempts..."

The configured host/port couldn't be reached (or the node rejected the connection) 3 times in a row. Double-check the host/port are correct and that the node is currently up — public nodes occasionally go down for maintenance. Try a different node from [ng3k.com's cluster list](https://www.ng3k.com/Misc/cluster.html) if the problem persists. Once you've made a change, toggle **Enable DX Cluster** off and back on to reset the attempt budget and try again.

### Connected, But No Spots Appear

- Check your **Band Filter**, **Callsign/Prefix Filter**, and **Keyword Filter** — an overly narrow filter combination can legitimately show nothing for a while. Try clearing the callsign and keyword filters first.
- Some cluster nodes default to a quiet period on connect, or have skimmer/automated spots turned off by default (as W3LPL's beta node does) — genuine manually-posted spots may simply take a few minutes to arrive, especially on quieter bands.
- Launch with `--debug-dxcluster` (see [Diagnostic Logging](Diagnostic-Logging)) to see the raw data the cluster node is sending, including any lines that failed to parse as spots — useful for confirming the connection is genuinely receiving traffic.

### It Asks for My Callsign — Is That Safe?

Yes. This is standard DX Cluster login convention (no password), and your callsign is public information anyway — every spot you'd ever look up on QRZ or similar already shows it. The login callsign is only used to identify your connection to the cluster node's sysop, the same as it would be if you telnetted in yourself with any other DX cluster client.
