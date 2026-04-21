# POTA and SOTA Spots

RigControl Web can display live activator spots for both **Parks on the Air (POTA)** and **Summits on the Air (SOTA)**. Spots are pulled directly from the POTA and SOTA APIs and updated automatically. Clicking any spot instantly tunes your radio to that frequency and sets the correct mode — no manual dial twisting needed.

---

## Enabling Spots

Spots are disabled by default. To turn them on:

1. Click the **gear icon** (⚙) to open General Settings.
2. Click the **SPOTS** tab.
3. Under **Spot Sources**, check the box next to **POTA**, **SOTA**, or both.

![RigControl Web — POTA/SOTA Settings](https://raw.githubusercontent.com/jbdubbs/Rig-Control-Web/main/assets/rigcontrolweb.manual.pota.sota.settings.png)

---

## POTA Options

Once POTA is enabled, a set of options appears for fine-tuning what you see.

### Poll Frequency

How often the app fetches new spots from the POTA API. Choose between 1 and 5 minutes. If you are actively hunting, a shorter poll interval keeps the list more current. For casual use, 3–5 minutes is fine and puts less load on the API.

### Max Spot Age

Spots older than this threshold are removed from the display. Options are 1, 3, 5, 10, or 15 minutes. Set this low (1–3 minutes) if you want only very fresh spots, or higher if you want to see a broader picture of activity on the bands.

### Band Filter

The band filter lets you limit the spot display to specific bands. Check the boxes for the bands you are interested in — 6M through 440 are available. Leave all boxes unchecked to show spots on all bands.

### Mode Filter

The mode filter narrows the display to a single mode: **SSB**, **CW**, **FT8**, **FT4**, or **ALL**. Select ALL to see spots regardless of mode.

---

## SOTA Options

SOTA has the same set of options as POTA — Poll Frequency, Max Spot Age, Band Filter, and Mode Filter — and they work identically. POTA and SOTA settings are configured and saved independently, so you can use different filters for each.

---

## Reading the Spots Table

Both POTA and SOTA spots are displayed as a table with the following columns:

| Column | What it shows |
|--------|--------------|
| **Activator** | The callsign of the station that is on the air |
| **Frequency** | The frequency in MHz where they are operating |
| **Mode** | The operating mode (SSB, CW, FT8, etc.) |
| **Location** | The park or summit reference and name |
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

## Where Spots Appear on Screen

The spots display adjusts its position based on your screen layout:

- **Phone layout** — A collapsible POTA and SOTA panel appears below Quick Controls. POTA and SOTA each have their own collapsible section. A floating indicator near the top of the screen shows the spot count and scrolls you to the panel when tapped if it is off screen.
- **Compact layout** — A tab row at the bottom of the main panel switches between **LEVELS** (the power/RF controls), **POTA**, and **SOTA**.
- **Desktop layout** — POTA and SOTA panels appear as full-width boxes below the Video & Audio section.

In all layouts, you can collapse the spot panel to reclaim screen space by clicking the collapse arrow in the panel header.
