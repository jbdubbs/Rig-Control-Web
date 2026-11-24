import fs from "fs";
import { Socket } from "socket.io";
import { vlogInfra as vlog } from "./vlog.ts";
import { CM108_AUTO } from "./ptt.ts";

// Linux-only enumeration of CM108-family USB HID devices (the GPIO PTT chips on AllScan,
// Masters Communications and similar interfaces), for the CM108 device picker and for
// resolving "auto" to a /dev/hidrawN path (Hamlib's Linux backend needs an explicit path).
//
// Windows and macOS don't enumerate here: their rigctld resolves "auto" itself, and a device
// path can still be typed in by hand.

export interface HidDeviceInfo {
  path: string;
  label: string;
}

// Same IDs Hamlib's src/cm108.c accepts (CM108/108B/109/119/119A/119B and SSS1621/23).
export function isCm108Compatible(vendor: number, product: number): boolean {
  if (vendor === 0x0d8c) {
    return (
      (product >= 0x0008 && product <= 0x000f) ||
      product === 0x0012 ||
      product === 0x0013 ||
      product === 0x013a ||
      product === 0x013c
    );
  }
  if (vendor === 0x0c76) {
    return product === 0x1605 || product === 0x1607 || product === 0x160b;
  }
  return false;
}

export interface HidUevent {
  vendor: number;
  product: number;
  name: string;
}

// Parses /sys/class/hidraw/hidrawN/device/uevent, e.g.:
//   HID_ID=0003:00000D8C:0000000C
//   HID_NAME=C-Media Electronics Inc.       USB Audio Device
export function parseHidUevent(text: string): HidUevent | null {
  const id = text.match(/^HID_ID=[0-9A-Fa-f]+:([0-9A-Fa-f]+):([0-9A-Fa-f]+)\s*$/m);
  if (!id) return null;
  const name = text.match(/^HID_NAME=(.*)$/m)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  return { vendor: parseInt(id[1], 16), product: parseInt(id[2], 16), name };
}

export function hexId(n: number): string {
  return n.toString(16).padStart(4, "0");
}

export function hidrawNumber(name: string): number | null {
  const m = name.match(/^hidraw(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

export function sortHidrawNames(names: string[]): string[] {
  return names
    .filter((n) => hidrawNumber(n) !== null)
    .sort((a, b) => (hidrawNumber(a) as number) - (hidrawNumber(b) as number));
}

export async function listHidrawDevices(sysRoot = "/sys/class/hidraw"): Promise<HidDeviceInfo[]> {
  if (process.platform !== "linux") return [];
  const entries = await fs.promises.readdir(sysRoot).catch(() => [] as string[]);
  const devices: HidDeviceInfo[] = [];
  for (const name of sortHidrawNames(entries)) {
    const text = await fs.promises.readFile(`${sysRoot}/${name}/device/uevent`, "utf-8").catch(() => null);
    const info = text === null ? null : parseHidUevent(text);
    if (!info || !isCm108Compatible(info.vendor, info.product)) continue;
    const label = `${info.name || "CM108"} (${hexId(info.vendor)}:${hexId(info.product)}) [${name}]`;
    devices.push({ path: `/dev/${name}`, label });
  }
  return devices;
}

export type PttFileResolution = { path: string } | { error: string };

// What to pass to rigctld's -p for CM108 PTT. Only Linux needs an explicit path; elsewhere
// "auto" is passed straight through for Hamlib to resolve.
export async function resolveCm108Path(
  pttFile: string | undefined,
  list: () => Promise<HidDeviceInfo[]> = listHidrawDevices,
  platform: NodeJS.Platform = process.platform,
): Promise<PttFileResolution> {
  const wanted = pttFile && pttFile.length > 0 ? pttFile : CM108_AUTO;
  if (wanted !== CM108_AUTO || platform !== "linux") return { path: wanted };
  const devices = await list();
  if (devices.length === 1) return { path: devices[0].path };
  if (devices.length === 0) {
    return { error: "No CM108 device found (check the USB connection and /dev/hidraw* permissions)" };
  }
  return {
    error: `Several CM108 devices found, select one in Settings: ${devices.map((d) => d.path).join(", ")}`,
  };
}

export function registerHidrawHandlers(socket: Socket): void {
  socket.on("get-hidraw-devices", async () => {
    vlog("[HIDRAW] Client requested CM108 device list");
    try {
      socket.emit("hidraw-devices-list", await listHidrawDevices());
    } catch (e: any) {
      vlog("[HIDRAW] Enumeration failed:", e?.message || e);
      socket.emit("hidraw-devices-list", []);
    }
  });
}
