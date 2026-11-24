// PTT settings validation shared by the settings handler and the rigctld arg builder.
// The CM108 fields end up on rigctld's command line, so they are validated here instead of
// being merged blindly like the rest of rigctldSettings.

export const PTT_TYPES = ["rig", "dtr", "rts", "none", "cm108"] as const;
export type PttType = (typeof PTT_TYPES)[number];

// "auto" lets Hamlib (Windows/macOS) or the server (Linux) pick the only attached CM108 device.
export const CM108_AUTO = "auto";

// Hamlib treats ptt_bitnum 0 as "unset" and silently substitutes its default (GPIO3), so GPIO1
// (bit 0) cannot be selected without keying the wrong pin. Only GPIO2-4 are offered.
export const CM108_GPIO_MIN = 2;
export const CM108_GPIO_MAX = 4;
export const CM108_GPIO_DEFAULT = 3;

export function sanitizePttType(value: unknown, fallback: PttType = "rig"): PttType {
  return typeof value === "string" && (PTT_TYPES as readonly string[]).includes(value)
    ? (value as PttType)
    : fallback;
}

export function sanitizeCm108Gpio(value: unknown, fallback = CM108_GPIO_DEFAULT): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= CM108_GPIO_MIN && n <= CM108_GPIO_MAX ? n : fallback;
}

// Accepts the device path forms Hamlib understands: a Linux hidraw node, a Windows HID interface
// path (\\?\hid#vid_0d8c&pid_000c&mi_03#...) or a macOS registry entry ID (DevSrvsID:123).
const CM108_PATH_PATTERNS = [
  /^\/dev\/hidraw\d{1,3}$/,
  /^\\\\\?\\hid#[A-Za-z0-9_&#{}\-\\.]{1,400}$/i,
  /^DevSrvsID:\d{1,20}$/,
];

export function isValidCm108Path(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === CM108_AUTO) return true;
  return CM108_PATH_PATTERNS.some((re) => re.test(value));
}

export function sanitizeCm108Path(value: unknown, fallback = CM108_AUTO): string {
  return isValidCm108Path(value) ? value : fallback;
}

// Returns `incoming` with the PTT fields it carries replaced by validated values (falling back
// to the current ones), leaving every other field untouched.
export function sanitizePttSettings<T extends object>(
  incoming: T,
  current: { pttType: PttType; pttFile: string; pttGpio: number },
): T {
  const out = { ...incoming } as Record<string, unknown>;
  if ("pttType" in out) out.pttType = sanitizePttType(out.pttType, current.pttType);
  if ("pttFile" in out) out.pttFile = sanitizeCm108Path(out.pttFile, current.pttFile);
  if ("pttGpio" in out) out.pttGpio = sanitizeCm108Gpio(out.pttGpio, current.pttGpio);
  return out as T;
}
