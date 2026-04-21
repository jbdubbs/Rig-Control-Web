# Connecting the Local Client

Once `rigctld` is running (see [Setting Up rigctld](Setting-Up-rigctld)), the next step is connecting RigControl Web to your radio. This page explains what "connecting" means and what to expect when you do.

---

## The Connect Button

At the top of the main screen you will see a button that reads either **CONNECT** or **DISCONNECT** depending on your current state.

- Click **CONNECT** to tell the app to start communicating with `rigctld` and, through it, your radio.
- Click **DISCONNECT** to stop the app from polling the radio. This does not stop `rigctld` — it just pauses the app's communication with it.

When you are connected, the button turns red and reads **DISCONNECT**, and a green dot appears next to the app title in the header to confirm the connection is live.

---

## What Happens When You Connect

As soon as the connection is established, the app starts polling your radio at the rate you set in the Poll Rate field. Within a second or two you should see:

- **Frequency** — Your current VFO frequency appears in the large display.
- **Mode** — The current operating mode (LSB, USB, CW, FM, etc.) appears in the mode selector.
- **Meters** — The S-Meter and any other supported meters begin updating in real time.

If the frequency display stays blank or shows an error, check that `rigctld` is running and showing a green **RUNNING** status in the Settings panel.

---

## Connection Status Indicator

The small colored dot in the app header tells you the connection state at a glance:

| Color | Meaning |
|-------|---------|
| Green | Connected and receiving data from the radio |
| No dot / dark | Not connected |

---

## Auto-Connect

If `rigctld` was set to auto-start (because it was running when you last closed the app), RigControl Web will also attempt to connect to the radio automatically when the app loads. You do not need to click Connect manually in this case.

---

## If the Connection Fails

If clicking Connect does not result in a green status dot:

1. Open General Settings (gear icon) and verify that `rigctld` is showing as **RUNNING**.
2. Check that the **Host Address** and **Port** in the Client Side Settings match the **Listen Address** and **Server Port** in the Server Side Settings.
3. Look at the Process Logs in the RIGCTLD tab for any error messages from `rigctld`.
4. Make sure your radio is powered on and the CAT cable is connected.
