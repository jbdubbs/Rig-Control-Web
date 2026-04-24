# Audio and Video

RigControl Web supports two-way audio (transmit and receive) and a live video feed of your radio's front panel. Both are configured through the **Video & Audio** section of the main screen and the **Video & Audio Settings** panel.

---

## Opening Video & Audio Settings

In the **Video & Audio** section header, click the **gear icon** to open the settings panel. This is where you configure your video capture device and both audio subsystems.

---

## Video

Video lets you see your radio's front panel display on screen, which is especially useful when operating remotely. A common setup is to connect your radio's DVI or HDMI output to a USB HDMI capture card plugged into your shack computer.

![RigControl Web — Video Settings](https://raw.githubusercontent.com/jbdubbs/Rig-Control-Web/main/assets/rigcontrolweb.manual.video.settings.png)

### Setting Up Video

1. Open Video & Audio Settings (gear icon in the Video & Audio section).
2. Under **Video Settings**, select your capture device from the **Video Device** dropdown. If you do not see your device, make sure it is connected and recognized by your operating system.
3. Set the **Resolution** — width × height in pixels. Match this to what your capture card supports, or start with `640 × 480` and adjust if needed.
4. Choose a **Framerate**. Lower framerates (5–10 fps) use less bandwidth and are fine for watching a radio display. Higher framerates (24–30 fps) look smoother but use more resources.
5. Click **Start Video**. The feed will appear in the Video & Audio panel on the main screen.
6. Click **Stop Video** to stop the feed.

The video feed is served from the server computer. Any client connected to RigControl Web will see the same video stream.

---

## Audio

The audio system lets you speak into your microphone and hear received audio through your speakers — just like operating from the shack, even when you are accessing the app remotely. Audio uses the Opus codec, which provides good voice quality at low bandwidth.

### Understanding the Two Audio Subsystems

This is the most important concept in the audio setup. RigControl Web has **two separate audio configurations**, and it is critical to understand what each one does:

**Backend Audio Engine (Server Side)**
> This is the audio hardware physically connected to your radio on your shack computer — for example, a Digirig, a USB audio interface, or your radio's built-in USB audio device. The backend audio engine runs on the server and is always tied to the hardware in your shack, regardless of where you are connecting from.
>
> - **Backend Input (Mic/Line)** — the audio coming *from* your radio into the computer (receive audio)
> - **Backend Output (Speakers)** — the audio going *to* your radio from the computer (transmit audio)

**Local Client Audio (Your System)**
> This is the microphone and speakers on *whatever device you are using to access the app* — your shack desktop, your laptop at a hotel, your phone in the other room. These are the devices you will actually speak into and listen through.
>
> - **Local Input (Microphone)** — your mic; what you speak into to transmit
> - **Local Output (Speakers/Headphones)** — your speakers or headphones; where you hear received audio

Think of it this way: **backend audio = the radio's end; local audio = your end**.

![RigControl Web — Audio Settings](https://raw.githubusercontent.com/jbdubbs/Rig-Control-Web/main/assets/rigcontrolweb.manual.audio.settings.png)

---

### Configuring Local Client Audio

1. Open Video & Audio Settings.
2. Under **Local Client Audio (Your System)**, select your microphone from the **Local Input (Microphone)** dropdown and your speakers or headphones from the **Local Output (Speakers/Headphones)** dropdown.
3. Use the **Local Speaker Volume** slider (directly below the Local Output dropdown) to set the playback volume for received audio.
4. These settings are saved in your browser and apply only to your device — a different device connecting to the same server will have its own local audio settings.

> **Browser permission:** The first time you use audio, your browser will ask for permission to access your microphone. You must allow this for transmit audio to work. If your microphone devices show without names (just "Input 1", etc.), click **Request Permission** next to the dropdown to prompt the browser permission dialog.

> **Device changes apply immediately** — you do not need to stop and restart audio when switching local devices or adjusting the speaker volume.

---

### Configuring Backend Audio

> The backend audio settings are configured once on the server (the shack computer). They do not need to be changed when connecting from a different device.

1. Open Video & Audio Settings.
2. Scroll down to the **Backend Audio Engine** section. It shows a **READY** or **FAILED** status badge indicating whether the audio hardware initialized correctly.
3. Select the audio device connected to your radio under **Backend Input (Mic/Line)** (receive audio from the radio). Use the toggle switch next to the label to enable or disable this direction.
4. Select the audio device connected to your radio under **Backend Output (Speakers)** (transmit audio to the radio). Use its toggle switch to enable or disable it.
5. Click **Start Backend Audio** to start the audio engine. The status will change to **RUNNING**.
6. Click **Stop Backend Audio** to stop it.

> **Choosing the right device on Windows:** The device list shows the host API (MME, DirectSound, WASAPI) alongside the device name. For most radios, MME or DirectSound works reliably. If using WASAPI, the device must be configured to 48 kHz in Windows Sound settings — an incompatible WASAPI device will be shown as disabled in the list.

> **Enabling/Disabling directions:** You can run inbound-only (receive audio only) or outbound-only (transmit audio only) if your setup requires it. Use the Enabled toggles next to each device selector.

---

### Starting and Joining Audio

Once the backend audio engine is running, the **Join Audio** button appears in the Video & Audio panel header on the main screen.

- **Join Audio** — Connects your browser session to the running audio stream. You will hear received audio through your local output device, and your local microphone will be available for transmitting. You must join audio before the mute buttons or PTT audio will work.

If the backend audio engine is not started yet, you will not see the Join Audio button. Start the backend audio engine first (in Video & Audio Settings), then join from the main screen.

---

### Mute Controls

Once you have joined audio, two mute buttons appear in the Video & Audio panel header:

- **Inbound mute** (headphone icon) — Mutes received audio so you do not hear it through your local speakers. The radio continues receiving; you just will not hear it.
- **Outbound mute** (microphone icon) — Mutes your microphone so your voice is not sent to the radio even if you key PTT.

---

### Local Speaker Volume

The **Local Speaker Volume** slider is found directly below the Local Output (Speakers/Headphones) dropdown in Video & Audio Settings.

- **0%** — silence (equivalent to mute, but continuous rather than a toggle)
- **100%** — unity gain: audio plays at your system volume level with no modification
- **101–200%** — amplification beyond system volume; useful when your OS volume is already at maximum and the received audio is still too quiet

The slider adjusts volume in real time with no need to stop or restart audio. Your setting is saved in the browser and restored automatically on your next visit.

---

### Multi-Client Audio

Multiple people can connect to the same RigControl Web server at the same time, and all of them can hear received audio simultaneously. However, only one client at a time can transmit. If another client's microphone is active, a warning will appear in the audio settings. Unmuting your own microphone (or pressing PTT) will transfer the transmit session to you.
