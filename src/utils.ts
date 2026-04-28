import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatStep(s: number): string {
  if (s >= 1) return `${s} MHz`;
  if (s >= 0.001) return `${s * 1000} kHz`;
  return `${s * 1000000} Hz`;
}
