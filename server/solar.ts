import type { Socket } from "socket.io";
import type { ServerContext, SolarData, HfBandCondition, VhfCondition } from "./context.ts";

const ONE_HOUR = 3_600_000;
const HF_ORDER = ["80m-40m", "30m-20m", "17m-15m", "12m-10m"];

function getText(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}>\\s*([^<]+)<\\/${tag}>`))?.[1]?.trim() ?? "";
}

async function fetchHamqslData(): Promise<Omit<SolarData, "esfi" | "essn" | "fetchedAt">> {
  const res = await fetch("https://www.hamqsl.com/solarxml.php", {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "RigControlWeb/1.0" },
  });
  const xml = await res.text();

  const hfMap: Record<string, Partial<HfBandCondition>> = {};
  for (const m of xml.matchAll(/<band name="([^"]+)" time="([^"]+)"[^>]*>([^<]+)<\/band>/g)) {
    const [, name, time, cond] = m;
    if (!hfMap[name]) hfMap[name] = { name };
    if (time === "day") hfMap[name].day = cond.trim();
    else if (time === "night") hfMap[name].night = cond.trim();
  }
  const hfBands: HfBandCondition[] = HF_ORDER
    .filter(n => hfMap[n]?.day && hfMap[n]?.night)
    .map(n => hfMap[n] as HfBandCondition);

  const vhfConditions: VhfCondition[] = [];
  for (const m of xml.matchAll(/<phenomenon name="([^"]+)" location="([^"]+)"[^>]*>([^<]+)<\/phenomenon>/g)) {
    const [, name, location, condition] = m;
    vhfConditions.push({ name, location, condition: condition.trim() });
  }

  return {
    updated: getText(xml, "updated"),
    solarflux: parseFloat(getText(xml, "solarflux")) || 0,
    sunspots: parseFloat(getText(xml, "sunspots")) || 0,
    aindex: parseFloat(getText(xml, "aindex")) || 0,
    kindex: parseFloat(getText(xml, "kindex")) || 0,
    xray: getText(xml, "xray"),
    signalnoise: getText(xml, "signalnoise"),
    geomagfield: getText(xml, "geomagfield"),
    solarwind: parseFloat(getText(xml, "solarwind")) || 0,
    magneticfield: parseFloat(getText(xml, "magneticfield")) || 0,
    aurora: parseFloat(getText(xml, "aurora")) || 0,
    protonflux: parseFloat(getText(xml, "protonflux")) || 0,
    electonflux: parseFloat(getText(xml, "electonflux")) || 0,
    hfBands,
    vhfConditions,
  };
}

async function fetchEssnData(): Promise<{ esfi: number | null; essn: number | null }> {
  const res = await fetch("https://prop.kc2g.com/api/essn.json", {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "RigControlWeb/1.0" },
  });
  const j = await res.json() as { "24h"?: Array<{ time: number; sfi: number; ssn: number }> };
  const series = j["24h"];
  if (!Array.isArray(series) || series.length === 0) return { esfi: null, essn: null };
  const last = series[series.length - 1];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    esfi: typeof last.sfi === "number" ? r1(last.sfi) : null,
    essn: typeof last.ssn === "number" ? r1(last.ssn) : null,
  };
}

export async function refreshSolarData(ctx: ServerContext): Promise<void> {
  const [hamqsl, essn] = await Promise.allSettled([fetchHamqslData(), fetchEssnData()]);

  if (hamqsl.status === "rejected") {
    console.error("[Solar] hamqsl fetch failed:", hamqsl.reason);
    return;
  }

  const essnResult = essn.status === "fulfilled"
    ? essn.value
    : { esfi: null, essn: null };

  if (essn.status === "rejected") {
    console.error("[Solar] kc2g essn fetch failed:", essn.reason);
  }

  ctx.solarData = {
    ...hamqsl.value,
    ...essnResult,
    fetchedAt: Date.now(),
  };
}

export function registerSolarHandlers(socket: Socket, ctx: ServerContext): void {
  socket.on("request-solar-data", async () => {
    const age = ctx.solarData ? Date.now() - ctx.solarData.fetchedAt : Infinity;
    if (age > ONE_HOUR) {
      await refreshSolarData(ctx);
    }
    if (ctx.solarData) {
      socket.emit("solar-data", ctx.solarData);
    }
  });
}
