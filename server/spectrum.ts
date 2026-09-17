import dgram from "dgram";
import os from "os";
import type { ServerContext } from "./context.ts";
import { vlogSpectrum, createRateLogger } from "./vlog.ts";

let spectrumRateLog = createRateLogger<number>(10_000, (count, _elapsed, pointCount) => {
  vlogSpectrum(`[SPECTRUM] ${count} packets received in last 10s (${pointCount} points each)`);
});

export function startSpectrumListener(ctx: ServerContext): void {
  if (ctx.spectrumSocket) {
    stopSpectrumListener(ctx);
  }

  spectrumRateLog = createRateLogger<number>(10_000, (count, _elapsed, pointCount) => {
    vlogSpectrum(`[SPECTRUM] ${count} packets received in last 10s (${pointCount} points each)`);
  });

  vlogSpectrum(`[SPECTRUM] Creating UDP socket (clientHost=${ctx.clientHost})`);
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });

  sock.on("error", (err) => {
    console.error(`[SPECTRUM] UDP socket error: ${err.message}`);
    ctx.spectrumSocket = null;
  });

  sock.on("message", (msg, rinfo) => {
    vlogSpectrum(`[SPECTRUM] UDP packet received: ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);

    let packet: any;
    try {
      packet = JSON.parse(msg.toString("utf8"));
    } catch (e: any) {
      console.error(`[SPECTRUM] JSON parse failed: ${e.message}`);
      vlogSpectrum(`[SPECTRUM] Raw message (first 200 bytes): ${msg.toString("utf8").slice(0, 200)}`);
      return;
    }

    // Spectrum data is in packet.spectra[]; skip status-only packets.
    const spectrum = packet.spectra?.[0];
    if (!spectrum) {
      vlogSpectrum(`[SPECTRUM] No spectra in packet seq=${packet.seq}, skipping`);
      return;
    }

    vlogSpectrum(`[SPECTRUM] seq=${packet.seq} type=${spectrum.type} centerFreq=${spectrum.centerFreq} length=${spectrum.length} dataLen=${(spectrum.data ?? "").length}`);

    const hexData: string = spectrum.data || "";
    if (hexData.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hexData)) {
      console.error(`[SPECTRUM] Malformed hex amplitude data (length=${hexData.length}) from ${rinfo.address}:${rinfo.port} — dropping packet`);
      return;
    }
    const amplitudes: number[] = Array.from(Buffer.from(hexData, "hex"));
    vlogSpectrum(`[SPECTRUM] Decoded ${amplitudes.length} amplitude points`);

    const clientCount = ctx.io.sockets.sockets.size;
    vlogSpectrum(`[SPECTRUM] Emitting spectrum-data to ${clientCount} client(s)`);

    spectrumRateLog(amplitudes.length);

    ctx.io.emit("spectrum-data", {
      id: spectrum.id ?? 0,
      name: spectrum.name ?? "",
      type: spectrum.type ?? "CENTER",
      length: spectrum.length ?? amplitudes.length,
      amplitudes,
      minLevel: spectrum.minStrength ?? 0,
      maxLevel: spectrum.maxStrength ?? 255,
      centerFreq: spectrum.centerFreq ?? 0,
      span: spectrum.span ?? 0,
      lowFreq: spectrum.lowFreq ?? 0,
      highFreq: spectrum.highFreq ?? 0,
      timestamp: Date.now(),
    });
  });

  sock.bind(ctx.spectrumSettings.multicastPort, () => {
    const addr = sock.address();
    vlogSpectrum(`[SPECTRUM] Socket bound to ${addr.address}:${addr.port} family=${addr.family}`);

    const joined: string[] = [];
    const failed: string[] = [];

    const tryJoin = (iface: string | undefined, label: string) => {
      try {
        sock.addMembership(ctx.spectrumSettings.multicastAddr, iface);
        joined.push(label);
        vlogSpectrum(`[SPECTRUM] Joined multicast on ${label}`);
      } catch (err: any) {
        failed.push(`${label} (${err.message})`);
        vlogSpectrum(`[SPECTRUM] Failed to join on ${label}: ${err.message}`);
      }
    };

    // Join on every non-loopback IPv4 interface so we receive regardless of
    // which adapter rigctld chooses for its multicast send.
    const ifaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;
      for (const a of addrs) {
        if (a.family !== "IPv4" || a.internal) continue;
        tryJoin(a.address, `${name}/${a.address}`);
      }
    }

    // Also join on the OS-chosen default interface as a fallback.
    tryJoin(undefined, "(default)");

    vlogSpectrum(
      `[SPECTRUM] Listening on multicast ${ctx.spectrumSettings.multicastAddr}:${ctx.spectrumSettings.multicastPort} — ` +
        `joined: [${joined.join(", ")}]` +
        (failed.length ? `  failed: [${failed.join(", ")}]` : ""),
    );
  });

  ctx.spectrumSocket = sock;
}

export function stopSpectrumListener(ctx: ServerContext): void {
  if (ctx.spectrumSocket) {
    try {
      ctx.spectrumSocket.close();
    } catch {
      // already closed
    }
    ctx.spectrumSocket = null;
    vlogSpectrum("[SPECTRUM] Listener stopped");
  }
}
