# Controls

This page covers the radio controls available in RigControl Web. Controls are organized into the VFO and frequency display at the top of the screen, the meters section, and the Quick Controls panel.

> **Important:** Not every radio supports every control listed here. RigControl Web probes your radio's capabilities when it connects, and buttons for unsupported functions are hidden or disabled automatically. If a control you expect to see is not there, your radio's Hamlib driver may not support it.

![RigControl Web — Compact View](https://raw.githubusercontent.com/jbdubbs/Rig-Control-Web/main/assets/rigcontrolweb.manual.compactview.main.png)

---

## VFO and Frequency

### VFO A / VFO B

Your radio's two VFOs are shown as **VFO A** and **VFO B** buttons at the top of the frequency section. Click either one to switch the active VFO. The active VFO is highlighted:

- **Green** = VFO A is active
- **Blue** = VFO B is active
- **Red** = That VFO is currently transmitting (during split operation)
- **Amber** = Split is active on that VFO

### SPLIT

The **SPLIT** button engages split VFO operation — transmitting on one VFO while receiving on the other. When split is active, the button turns amber. Click it again to turn split off.

During split operation the frequency display shows both VFO A and VFO B frequencies.

### Frequency Display

The large number in the center of the VFO section shows your current frequency in MHz. You can edit it directly:

1. Click the pencil icon (or tap the frequency display on touch screens) to enter edit mode.
2. Type the frequency you want (in MHz, e.g. `14.225`).
3. Press Enter or click away to tune to that frequency.

### Tuning Steps

Below the frequency display are step buttons: **10Hz**, **100Hz**, **1k**, **3k**, **10k**, **100k**. The highlighted button is the active step size. Use the **< 1k** and **1k >** arrow buttons on either side of the display to step the frequency down or up by the selected amount.

### Mode and Bandwidth

To the right of the frequency display are two dropdowns:

- **Mode** — Select your operating mode (LSB, USB, CW, AM, FM, etc.). The app immediately sends the change to the radio.
- **Bandwidth** — Select the IF filter bandwidth. Available options depend on your radio model.

---

## Meters

The meters section shows readings from the radio in real time. Available meters depend on your radio.

| Meter | What it shows |
|-------|--------------|
| **SIGNAL** | S-Meter reading while receiving; transmit power output while transmitting |
| **SWR** | Standing Wave Ratio on transmit |
| **ALC** | Automatic Level Control — useful for monitoring audio drive on SSB |
| **VDD** | Supply voltage (on supported radios) |

Click the tab labels (SIGNAL, SWR, ALC, VDD) to switch which meter is graphed. On the phone layout, these appear as tab buttons above a single graph.

---

## Quick Controls

The **Quick Controls** panel contains buttons for the most commonly used radio functions. All of these send commands directly to the radio through `rigctld`.

### PTT

**PTT** stands for Push-To-Talk. Click this button to key the radio for transmit. Click again to return to receive. When the radio is transmitting, PTT turns red.

On the phone layout, there is a large dedicated PTT button fixed at the bottom of the screen for easy one-thumb access.

> If audio is running, PTT will also activate your microphone automatically when you key up (and release it when you unkey), provided outbound audio is enabled and your microphone is not muted.

---

## CW Keyer

RigControl Web includes a full iambic CW keyer that works from any browser or the Electron app — including phones and tablets.

### Enabling the Keyer

Open **General Settings → KEYER** and toggle **Enable CW Keyer** on. The keyer only becomes active once the audio subsystem is running (join audio first). Once enabled, an indicator in the Quick Controls area shows the current key state and WPM.

### Keyboard Keys (Desktop)

By default:
- **Left Ctrl** — Dit
- **Right Ctrl** — Dah
- **Space** — Straight key (when straight key mode is selected)

Keys can be rebound in the KEYER settings tab — click the binding field and press any key to reassign it. Key presses are ignored when a text input has focus, so you can still type normally while the keyer is enabled.

### Touch Paddles (Phone and Tablet)

When the rig is in a CW mode (`CW`, `CWR`) and the keyer is enabled, the PTT button at the bottom of the phone layout is automatically replaced by two large touch paddle buttons:

- **· dit** — Left paddle
- **— dah** — Right paddle

Hold them like iambic paddles. Both can be held simultaneously for automatic alternating dit-dah sequences in iambic mode.

### Keying Modes

| Mode | Behavior |
|------|----------|
| **Iambic A** | Releases the current element when both paddles are released mid-squeeze |
| **Iambic B** | Completes one additional element after both paddles are released mid-squeeze |
| **Straight Key** | Key down while held, key up on release — no timing logic |

### Sidetone

The keyer plays a local audio tone in your browser as you key, giving you instant feedback with no network latency. This is entirely separate from any audio coming back from the radio. You can:

- Enable or disable the sidetone independently of the keyer
- Adjust the tone frequency (Hz) and volume
- The sidetone is automatically routed to the same audio output device you have selected in the Audio settings

### Key Output

The physical key signal can be sent three ways (configured in KEYER settings):

| Method | Description |
|--------|-------------|
| **DTR** | Keys a DTR line on a serial port (most common — works with Digirig, SignaLink, and similar) |
| **RTS** | Keys an RTS line on the same or a different serial port |
| **rigctld-PTT** | Uses Hamlib's PTT command — useful for radios where the key line is handled by the rig itself |

### TUNE

The **TUNE** button activates your radio's built-in antenna tuner (if equipped). The tuner will run its tuning cycle and then return to receive.

### ATT

**ATT** stands for Attenuator. This reduces the signal level coming into the receiver — useful when you are very close to a strong transmitter and the front end is overloading. Click to toggle the attenuator on or off.

### P.AMP

**P.AMP** stands for Preamplifier. This boosts weak incoming signals before they reach the receiver's front end. Click to toggle the preamp on or off.

### NB

**NB** stands for Noise Blanker. The noise blanker is a circuit designed to remove short, sharp pulses of interference — for example, ignition noise or power line clicks. Click NB to toggle it on or off. When it is on, the button glows green.

Use the **NB Level** slider that appears below the buttons to adjust how aggressively the noise blanker works. Higher levels remove more noise but can also affect nearby signals, so find the lowest setting that provides relief.

### ANF

**ANF** stands for Automatic Notch Filter. The ANF automatically detects and removes steady tones — such as a carrier or a heterodyne — from the received audio without you having to tune a manual notch. Click to toggle it on or off.

### AGC

**AGC** stands for Automatic Gain Control. AGC automatically adjusts the radio's receive amplification so that loud and weak signals are both heard at a comfortable volume. The button cycles through the AGC speed settings your radio supports (typically FAST, MED, SLOW, and OFF). The current setting is shown below the button.

### DNR

**DNR** stands for Digital Noise Reduction. Unlike the hardware noise blanker, DNR uses digital signal processing to reduce random background noise — hiss, hash, and general band noise. Click DNR to toggle it on or off. When on, use the **DNR Level** slider to adjust the strength of the noise reduction. Start low and increase until the noise drops without making voices sound processed.

### RF Level

The **RF Level** slider controls the radio's RF output power. Slide left to reduce power, right for full power. The current level is shown as a percentage.

---

## Controls on the Phone Layout

On the phone layout, all of the controls above are available inside the collapsible **Quick Controls** panel. Tap the panel header to expand it. The large PTT button at the bottom of the screen is always visible regardless of whether Quick Controls is expanded.

When the CW keyer is enabled and the rig is in a CW mode, the PTT button at the bottom is automatically replaced by the dit/dah touch paddles described in the [CW Keyer](#cw-keyer) section above.
