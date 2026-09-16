// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshSolarData } from './solar.ts';
import type { ServerContext, SolarData } from './context.ts';

const STALE_SOLAR_DATA: SolarData = {
  updated: 'stale reading',
  solarflux: 123,
  sunspots: 45,
  aindex: 3,
  kindex: 1,
  xray: 'A1.0',
  signalnoise: 'S1',
  geomagfield: 'Quiet',
  solarwind: 300,
  magneticfield: 2,
  aurora: 1,
  protonflux: 1,
  electonflux: 1,
  esfi: 100,
  essn: 50,
  hfBands: [{ name: '80m-40m', day: 'Good', night: 'Good' }],
  vhfConditions: [],
  fetchedAt: Date.now() - 1000,
};

const VALID_XML = `
<solar><solardata>
<updated>1 Jan 2026 0000 GMT</updated>
<solarflux>150</solarflux>
<sunspots>80</sunspots>
<aindex>5</aindex>
<kindex>2</kindex>
<xray>A1.0</xray>
<signalnoise>S1</signalnoise>
<geomagfield>Quiet</geomagfield>
<solarwind>350</solarwind>
<magneticfield>2</magneticfield>
<aurora>1</aurora>
<protonflux>1</protonflux>
<electonflux>1</electonflux>
</solardata></solar>
`;

function makeCtx(): ServerContext {
  return { solarData: { ...STALE_SOLAR_DATA } } as unknown as ServerContext;
}

function stubFetch(hamqslResponse: any) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('hamqsl')) return hamqslResponse;
    return { ok: true, json: async () => ({ '24h': [] }) };
  }));
}

describe('refreshSolarData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the stale cache when hamqsl.com returns a non-2xx status', async () => {
    stubFetch({ ok: false, status: 503, text: async () => '<html>maintenance</html>' });

    const ctx = makeCtx();
    await refreshSolarData(ctx);

    expect(ctx.solarData).toEqual(STALE_SOLAR_DATA);
  });

  it('updates solarData when hamqsl.com returns a successful response', async () => {
    stubFetch({ ok: true, text: async () => VALID_XML });

    const ctx = makeCtx();
    await refreshSolarData(ctx);

    expect(ctx.solarData?.solarflux).toBe(150);
    expect(ctx.solarData?.sunspots).toBe(80);
    expect(ctx.solarData?.updated).toBe('1 Jan 2026 0000 GMT');
    expect(ctx.solarData?.fetchedAt).toBeGreaterThan(STALE_SOLAR_DATA.fetchedAt);
  });
});
