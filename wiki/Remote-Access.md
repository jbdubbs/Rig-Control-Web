# Remote Access

RigControl Web includes a built-in secure web server, which means you can access your shack radio from any device on your local network — or from anywhere in the world over a VPN — without installing any extra software on the connecting device. All you need is a web browser.

---

## How It Works

When RigControl Web is running on your shack computer, it automatically starts an HTTPS web server on **port 3000**. Any browser that can reach that computer on port 3000 can connect and use the full interface — including audio, video, and rig control.

> **HTTPS is required for audio.** Web browsers only allow microphone access on secure (HTTPS) connections. The built-in server handles this automatically using a self-signed certificate that it generates and manages for you. No extra setup is needed for local network or VPN use.

---

## Finding Your Server's IP Address

To connect from another device, you need the local IP address of your shack computer.

**On Windows:** Open a Command Prompt and type `ipconfig`. Look for the IPv4 address under your network adapter (usually something like `192.168.1.x`).

**On Linux:** Open a terminal and type `ip addr` or `hostname -I`. Look for the address on your local network interface.

Once you have the address, the URL you will use from the remote device is:

```
https://192.168.1.x:3000
```

(Replace `192.168.1.x` with your actual server IP address.)

---

## Accepting the Certificate Warning

The first time you open the app in a new browser, you will see a security warning. This is normal and expected — it is caused by the self-signed certificate, not by anything wrong with the app or your network. The certificate keeps your connection encrypted; it simply has not been issued by a trusted authority the way a commercial website's certificate would be.

**To proceed:**

- **Chrome / Edge:** Click **Advanced**, then click **Proceed to [IP address] (unsafe)**
- **Firefox:** Click **Advanced...**, then click **Accept the Risk and Continue**
- **Safari (iPhone/iPad):** Tap **Show Details**, then tap **visit this website**, then tap **Visit Website** in the confirmation dialog

You only need to do this once per browser. After accepting, the browser remembers the exception and will connect without the warning in the future.

> **The certificate auto-renews.** RigControl Web regenerates the certificate if it is within 30 days of expiring, or if your server computer's local IP address changes. If you ever see the warning again after having already accepted it, it likely means your server's IP changed (for example, your router assigned it a new address). Simply accept the warning again.

---

## Connecting

Once you have accepted the certificate, the RigControl Web interface loads just like it does on the server computer itself. All features are available:

- Full rig control (frequency, mode, VFO, split, all quick controls)
- Live meters
- PTT and transmit/receive audio
- Video feed
- POTA and SOTA spots

---

## Audio Over a Remote Connection

Audio works the same way whether you are on the same computer as the server or connecting from across the house. However, it is important to understand **which device's audio hardware is being used where**.

### Backend Audio (Server Side — Always the Shack Hardware)

The **Backend Audio Engine** runs on the server computer and is always connected to your radio's audio interface — your Digirig, USB audio adapter, or radio's built-in USB audio. These devices are configured once on the server and do not change when you connect remotely.

- **Backend Input** = the receive audio coming from your radio into the server computer
- **Backend Output** = the transmit audio going from the server computer to your radio

You do not need to change backend audio settings when connecting from a remote device.

### Local Client Audio (Your End — Changes With Each Device)

The **Local Client Audio** settings — microphone input and speaker output — refer to the hardware on *whichever device you are currently using*. If you are on a laptop, they are your laptop's microphone and speakers. If you are on a phone, they are your phone's microphone and speaker.

Each device saves its own local audio settings separately in the browser. The first time you connect from a new device, you will need to:

1. Open Video & Audio Settings (gear icon in the Video & Audio section header).
2. Select your microphone under **Local Input (Microphone)**.
3. Select your speakers or headphones under **Local Output (Speakers/Headphones)**.

### Joining Audio From a Remote Device

1. Make sure the **Backend Audio Engine** is running on the server. (This is configured at the shack computer and should already be set up.)
2. Click **Join Audio** in the Video & Audio panel header. The button appears when the backend is active.
3. Your browser will request microphone permission the first time. Allow it.
4. You will immediately begin hearing received audio through your local speakers.
5. Use PTT to transmit — your voice travels from your device's microphone, through the internet or VPN, to the server, and out to the radio.

---

## VPN vs. Local Network

For connections within your home network (same Wi-Fi or wired network), the built-in HTTPS server is all you need.

For connections **outside your home network** — from a hotel, a friend's house, a mobile hotspot, or anywhere else — you will need a VPN that puts your remote device on the same network as your shack computer. Common solutions include Tailscale, WireGuard, and OpenVPN. Once your VPN is connected, use the server's VPN-assigned IP address in the browser the same way you would use the local network IP.

> Exposing RigControl Web directly to the public internet without a VPN is not recommended. The built-in certificate is self-signed and the app has no built-in user authentication. A VPN is the simplest and safest approach for remote access.

---

## Multiple Simultaneous Clients

Any number of clients can be connected at the same time. All of them see the same real-time frequency and meter data. All of them can hear received audio simultaneously. Only one client at a time can hold the active transmit microphone — see [Audio and Video](Audio-and-Video) for details on how microphone priority works.
