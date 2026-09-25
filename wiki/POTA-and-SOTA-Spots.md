# POTA, SOTA, and WWFF Spots

RigControl Web can display live activator spots for **Parks on the Air (POTA)**, **Summits on the Air (SOTA)**, and **World Wide Flora & Fauna (WWFF)**. Spots are pulled directly from the respective APIs and updated automatically. Clicking any spot instantly tunes your radio to that frequency and sets the correct mode — no manual dial twisting needed.

> Looking for a specific station or region rather than award-program activators? See [DX Cluster Spotting](DX-Cluster-Spotting) for the live telnet DX Cluster feed instead.

---

## Adding a Spots Panel

Spots panels are added to your layout like any other panel. Click the **Edit** button to enter layout edit mode, then click **Add Panel** and choose from:

- **POTA Spots** — Parks on the Air activators
- **SOTA Spots** — Summits on the Air activators
- **WWFF Spots** — World Wide Flora & Fauna activators
- **All Spots** — A combined panel showing POTA, SOTA, WWFF, and DX Cluster together in a single tabbed view (see [DX Cluster Spotting](DX-Cluster-Spotting) for that tab's own settings)

Once a panel is placed in your layout, it begins fetching spots automatically. You can have individual panels for each service, the combined All Spots panel, or a mix of both.

---

## Settings

Each spots panel has a gear icon (⚙) in its header. Click it to open the settings for that panel. The **All Spots** panel's settings cover POTA, SOTA, and WWFF independently under separate tabs — its DX tab is different enough (a live connection rather than a poll) that it's documented separately in [DX Cluster Spotting](DX-Cluster-Spotting).

### Poll Frequency

How often the app fetches new spots from the API. Choose between 1 and 5 minutes. If you are actively hunting, a shorter interval keeps the list more current. For casual use, 3–5 minutes is fine and puts less load on the API.

### Max Spot Age

Spots older than this threshold are removed from the display. Options are 1, 3, 5, 10, or 15 minutes. Set this low (1–3 minutes) if you want only very fresh spots, or higher if you want a broader picture of activity on the bands.

### Band Filter

Limits the spot display to specific bands. Check the boxes for the bands you are interested in. Leave all boxes unchecked to show spots on all bands.

### Mode Filter

Narrows the display to a single mode: **SSB**, **CW**, **FT8**, **FT4**, or **All**. Select All to see spots regardless of mode.

Settings for POTA, SOTA, and WWFF are stored and applied independently — you can use different filters for each.

---

## Reading the Spots Table

Each spots panel shows a table with the following columns:

| Column | What it shows |
|--------|--------------|
| **Activator** | The callsign of the station on the air |
| **Frequency** | The frequency in MHz where they are operating |
| **Mode** | The operating mode (SSB, CW, FT8, etc.) |
| **Location** | The park, summit, or flora & fauna reference and name |
| **Age** | How long ago this spot was posted (e.g. "2m ago") |

Only the most recent spot per activator is shown — if the same callsign has been spotted multiple times, only the latest one appears.

---

## Sorting

Click any column header to sort by that column. Clicking the same header again reverses the sort direction. A third click returns to the default API order (most recent spot first). A small arrow in the header shows the current sort direction.

---

## Click-to-Tune

Click any row in the spots table to instantly tune your radio to that frequency and set the correct mode.

For SSB spots, the app automatically selects **USB** for frequencies above 10 MHz and **LSB** for frequencies at or below 10 MHz, following the standard band plan convention.

> You must be connected to your rig (green status dot in the header) for click-to-tune to work. If you are not connected, the spot rows are grayed out with a tooltip reminding you to connect first.

---

## Collapsing Panels

In all layouts you can collapse any spots panel by clicking the collapse arrow in the panel header to reclaim screen space when you are not actively hunting.

---

## Troubleshooting

### Spots Panel Shows "No spots in the last X min..." Even Though Activators Are On the Air

The most common cause is **an incorrect system clock on your computer**. Spots are fetched from the POTA, SOTA, and WWFF APIs with UTC timestamps, and the app compares those timestamps to your local system clock to calculate spot age. If your computer's clock is even a few minutes fast, every spot will appear older than it actually is and the max-age filter will drop them all.

**To check and fix (Windows):**

1. Open **Settings → Time & date**.
2. Make sure **Set time automatically** is turned **On**.
3. Click **Sync now** to force an immediate NTP time sync.
4. Verify the **Time zone** is set correctly for your location — a wrong timezone with a manually corrected local time still produces incorrect UTC, which is what the spot age calculation uses.

**To check and fix (Linux):**

```
timedatectl status
```

Verify that `System clock synchronized: yes` and the timezone is correct. If the clock is out of sync, run:

```
sudo timedatectl set-ntp true
```

**How to confirm this is the issue:** Launch the app with `--debug-spots` and open the browser DevTools console (`F12` → Console tab). Look for the `[spots:pota] Filter pipeline` log line — it prints the `cutoff` timestamp (derived from your system clock) and the `sample spotTime` (from the API). If the cutoff is significantly ahead of the sample time, your clock is fast and spots are being filtered as too old.

### Only One Spot Type Appears (e.g., POTA But Not SOTA or WWFF)

If you are using the **All Spots** panel, all three spot types (POTA, SOTA, WWFF) are fetched automatically. If you are using individual panels (POTA Spots, SOTA Spots, WWFF Spots), only the types with a panel in your layout will be fetched. Add the missing panel via **Edit → Add Panel** or switch to the **All Spots** combined panel.

### Spots Load on One Machine But Not Another

Spots are fetched browser-side directly from external APIs (api.pota.app, api2.sota.org.uk, spots.wwff.co). If one machine works and another does not, check:

- **System clock** — see above. This is the most common cause.
- **Firewall or security software** — the fetch requests are outbound HTTPS to the spot APIs. Corporate firewalls, VPNs, or antivirus software may block these connections on one machine but not another.
- **Network connectivity** — verify you can reach the APIs by opening `https://api.pota.app/spot/` in a browser tab on the affected machine.
