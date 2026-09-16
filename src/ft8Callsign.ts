// Extracts the transmitting station's callsign from a decoded FT8 message
// and resolves it to a country via src/dxccPrefixes.ts. Pure, side-effect-free
// logic used by Ft8DecodePanel.tsx's "Country" column.
import { DXCC_PREFIXES, type DxccPrefixEntry } from './dxccPrefixes';

const GRID_RE = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/i;
const SUFFIX_QUALIFIERS = new Set(['P', 'M', 'MM', 'QRP', 'A', 'R']);
const NON_CALLSIGN_TOKENS = new Set(['RR73', 'RRR', '73']);

function isGridSquare(token: string): boolean {
  return GRID_RE.test(token);
}

// Picks the token representing the TRANSMITTING station out of a full FT8
// message (ft8_lib's message.h directed/CQ grammars). Returns null for
// anything not confidently parsed (free text, telemetry, contest-specific
// exchanges) rather than guessing — a blank "Country" cell is a safe
// failure mode, a wrong one is not.
export function extractTransmittingToken(message: string): string | null {
  const tokens = message.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens[0].toUpperCase() === 'CQ') {
    if (tokens.length === 2) return tokens[1];
    if (tokens.length >= 3) {
      const last = tokens[tokens.length - 1];
      return isGridSquare(last) ? tokens[tokens.length - 2] : null;
    }
    return null;
  }
  if (tokens.length >= 2) return tokens[1]; // <call_to> <call_de> <extra>
  return null;
}

// Strips <...> hashed-callsign brackets and /portable, /area, or
// /prefix-override suffixes down to the bare callsign (or location prefix)
// to look up.
export function normalizeCallsign(raw: string): string | null {
  let t = raw.trim().replace(/^</, '').replace(/>$/, '').toUpperCase();
  if (!t) return null;
  if (t.includes('/')) {
    const parts = t.split('/');
    if (parts.length !== 2) return null;
    const [a, b] = parts;
    const isQualifier = (s: string) => SUFFIX_QUALIFIERS.has(s) || /^[0-9]{1,2}$/.test(s);
    if (isQualifier(b)) t = a;
    else if (isQualifier(a)) t = b;
    else t = a.length <= b.length ? a : b; // shorter side = location prefix (e.g. PJ4/KA1ABC -> PJ4)
  }
  return t || null;
}

// Load-bearing false-positive guard: rejects free text before it can
// accidentally match a single-letter prefix (e.g. "NEW" in "HAPPY NEW YEAR"
// would otherwise match "N" = United States).
function looksLikeCallsign(token: string): boolean {
  return /^[A-Z0-9]{3,8}$/.test(token)
    && /[0-9]/.test(token) && /[A-Z]/.test(token)
    && !isGridSquare(token) && !NON_CALLSIGN_TOKENS.has(token);
}

// Longest-prefix match: more specific entries (e.g. "KH6" for Hawaii)
// automatically win over shorter ones that would also match (e.g. "K" for
// the United States), regardless of table order.
export function lookupCountry(callsign: string): DxccPrefixEntry | null {
  let best: DxccPrefixEntry | null = null;
  for (const entry of DXCC_PREFIXES) {
    if (callsign.startsWith(entry.prefix) && (!best || entry.prefix.length > best.prefix.length)) {
      best = entry;
    }
  }
  return best;
}

// One-shot convenience for the panel: message text in, resolved
// country/flag out (or null when nothing can be confidently resolved).
export function getCallingStationCountry(message: string): DxccPrefixEntry | null {
  const token = extractTransmittingToken(message);
  if (!token) return null;
  const normalized = normalizeCallsign(token);
  if (!normalized || !looksLikeCallsign(normalized)) return null;
  return lookupCountry(normalized);
}
