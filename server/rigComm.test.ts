// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatExtendedCommand, normalizeVfoName, parseDumpCapsIntoContext, parseExtendedResponse, resetRigState, sendToRig } from './rigComm.ts';
import { createInitialContext } from './context.ts';

describe('priority command ordering', () => {
  it('preserves CW edges while overtaking normal polling on a busy link', () => {
    const ctx = { isRigBusy: true, rigCommandQueue: [] } as any;
    void sendToRig(ctx, 'f');
    void sendToRig(ctx, 'T 1', false, true);
    void sendToRig(ctx, 'T 0', false, true);
    void sendToRig(ctx, 'T 1', false, true);
    expect(ctx.rigCommandQueue.map((entry: any) => entry.cmd)).toEqual(['T 1', 'T 0', 'T 1', 'f']);
  });
});

describe('normalizeVfoName', () => {
  it('maps Main/Sub to VFOA/VFOB', () => {
    expect(normalizeVfoName('Main')).toBe('VFOA');
    expect(normalizeVfoName('Sub')).toBe('VFOB');
  });

  it('passes through already-normalized or unrecognized names', () => {
    expect(normalizeVfoName('VFOA')).toBe('VFOA');
    expect(normalizeVfoName('VFOB')).toBe('VFOB');
    expect(normalizeVfoName('Other')).toBe('Other');
  });

  it('trims whitespace before comparing', () => {
    expect(normalizeVfoName('  Main  ')).toBe('VFOA');
    expect(normalizeVfoName('  Sub\n')).toBe('VFOB');
  });
});

describe('formatExtendedCommand', () => {
  it('prefixes single-letter short-form commands with +', () => {
    expect(formatExtendedCommand('f')).toBe('+f');
    expect(formatExtendedCommand('  t  ')).toBe('+t');
  });

  it('prefixes multi-letter long-form commands with +\\', () => {
    expect(formatExtendedCommand('get_powerstat')).toBe('+\\get_powerstat');
  });

  it('preserves arguments after a single-letter command name', () => {
    expect(formatExtendedCommand('F 14074000')).toBe('+F 14074000');
  });

  it('preserves arguments after a long-form command name', () => {
    expect(formatExtendedCommand('set_freq 14074000')).toBe('+\\set_freq 14074000');
  });
});

describe('parseExtendedResponse', () => {
  it('returns the raw response unchanged if it has fewer than 3 lines', () => {
    expect(parseExtendedResponse('RPRT 0')).toBe('RPRT 0');
    expect(parseExtendedResponse('Frequency: 14074000\nRPRT 0')).toBe(
      'Frequency: 14074000\nRPRT 0',
    );
  });

  it('throws on an RPRT 1 error response', () => {
    expect(() =>
      parseExtendedResponse('get_freq:\nFrequency: 14074000\nRPRT 1'),
    ).toThrow('Rig command error (RPRT 1)');
  });

  it('strips the echoed command line and trailing RPRT line, extracting labeled values', () => {
    const resp = 'get_freq:\nFrequency: 14074000\nRPRT 0';
    expect(parseExtendedResponse(resp)).toBe('14074000');
  });

  it('joins multiple labeled value lines with newlines', () => {
    const resp = 'get_mode:\nMode: USB\nPassband: 2400\nRPRT 0';
    expect(parseExtendedResponse(resp)).toBe('USB\n2400');
  });

  it('passes through lines with no colon label as-is', () => {
    const resp = 'dump_state:\nplain line\nRPRT 0';
    expect(parseExtendedResponse(resp)).toBe('plain line');
  });
});

describe('parseDumpCapsIntoContext', () => {
  // Reproduces the Xiegu G90's dump_caps "Get level:" line as seen in a real diagnostics log:
  // RFPOWER is listed but with a degenerate 0..0/0 range, and RF (receiver gain) isn't listed
  // as a distinct token at all — both despite the rig genuinely supporting live get/set for
  // both levels (confirmed by "l RFPOWER"/"l RF" succeeding with RPRT 0 during polling).
  const g90GetLevelLine =
    'Get level: PREAMP(0,0/0) ATT(0,0/0) VOX(0.000000..1.000000/0.000000) AF(0.000000..1.000000/0.000000) ' +
    'SQL(0.000000..1.000000/0.000000) RFPOWER(0.000000..0.000000/0.000000) ' +
    'MICGAIN(0.000000..1.000000/0.000000) AGC(0,0/0) CWPITCH(0.000000..1.000000/0.000000) ' +
    'KEYSPD(0.000000..1.000000/0.000000)\n';

  it('falls back to the default RFPOWER range when dump_caps reports a degenerate 0..0/0 range', () => {
    const ctx = createInitialContext({} as any, '/base', '/data');
    const dump = `Caps dump for model:\nGet functions: NB\n${g90GetLevelLine}`;

    parseDumpCapsIntoContext(dump, ctx);

    expect(ctx.rigctldSettings.rfPowerRange).toEqual({ min: 0, max: 1, step: 0.01 });
  });

  it('reports RF as unsupported when dump_caps has no distinct RF( token', () => {
    const ctx = createInitialContext({} as any, '/base', '/data');
    const dump = `Caps dump for model:\nGet functions: NB\n${g90GetLevelLine}`;

    parseDumpCapsIntoContext(dump, ctx);

    // dump_caps parsing alone reports false here — this is why probeCapabilities() additionally
    // corroborates with a live "l RF" probe before trusting this as the final answer, since the
    // G90 demonstrably supports get_level RF at runtime despite dump_caps staying silent on it.
    expect(ctx.rigctldSettings.rfLevelSupported).toBe(false);
    expect(ctx.rigctldSettings.rfLevelRange).toEqual({ min: 0, max: 1, step: 0.1 });
  });

  it('reports RF as unsupported when dump_caps lists RF( with a degenerate 0..0/0 range', () => {
    // Captured live from a real G90 (2026-07-24): unlike the fixture above, this firmware/
    // dump_caps snapshot DOES include a distinct "RF(" token, but with the same degenerate
    // 0.000000..0.000000/0.000000 range RFPOWER has. Trusting the bare regex match (as an
    // earlier version of this fix did) sets rfLevelSupported=true with rfLevelRange stuck at
    // min=max=0 — broken the same way the unfixed RFPOWER case was, just via a different path
    // (a "present but useless" match rather than "absent"), and one the live-probe
    // corroboration in probeCapabilities() never even reaches, since it's gated on
    // rfLevelSupported already being false.
    const ctx = createInitialContext({} as any, '/base', '/data');
    const dump =
      'Caps dump for model: 3088\nGet functions: NB COMP VOX TONE TSQL SBKIN FBKIN MON MN LOCK VSC TUNER\n' +
      'Get level: PREAMP(0..0/0) ATT(0..0/0) AF(0.000000..0.000000/0.000000) ' +
      'RF(0.000000..0.000000/0.000000) SQL(0.000000..0.000000/0.000000) CWPITCH(0..0/0) ' +
      'RFPOWER(0.000000..0.000000/0.000000) KEYSPD(0..0/0) AGC(0..0/0) RAWSTR(0..255/0) ' +
      'SWR(0.000000..0.000000/0.000000)\n';

    parseDumpCapsIntoContext(dump, ctx);

    expect(ctx.rigctldSettings.rfLevelSupported).toBe(false);
    expect(ctx.rigctldSettings.rfLevelRange).toEqual({ min: 0, max: 1, step: 0.1 });
    expect(ctx.rigctldSettings.rfPowerRange).toEqual({ min: 0, max: 1, step: 0.01 });
  });

  it('parses a well-formed Get level line (e.g. Hamlib Dummy rig) without falling back', () => {
    const ctx = createInitialContext({} as any, '/base', '/data');
    const dump =
      'Caps dump for model:\nGet functions: NB NR ANF\n' +
      'Get level: RF(0.050000..1.000000/0.001957) RFPOWER(0.000000..1.000000/0.001957) ' +
      'NB(0.000000..1.000000/0.100000) NR(0.000000..1.000000/0.066667)\n';

    parseDumpCapsIntoContext(dump, ctx);

    expect(ctx.rigctldSettings.rfLevelSupported).toBe(true);
    expect(ctx.rigctldSettings.rfLevelRange).toEqual({ min: 0.05, max: 1, step: 0.001957 });
    expect(ctx.rigctldSettings.rfPowerRange).toEqual({ min: 0, max: 1, step: 0.001957 });
  });
});

describe('resetRigState', () => {
  it('resets power/capability flags and lastStatus to their documented defaults', () => {
    const ctx = createInitialContext({} as any, '/base', '/data');

    // Dirty the fields resetRigState is responsible for clearing.
    ctx.vfoSupported = false;
    ctx.powerSupported = true;
    ctx.powerState = 'off';
    ctx.powerOpInProgress = true;
    ctx.lastPowerCheck = 123456;
    ctx.powerOffProbeFailureCount = 3;
    ctx.pendingCapabilityProbe = true;
    ctx.knownPoweredOff = true;
    ctx.lastStatus = { ...ctx.lastStatus, frequency: '7074000', ptt: true, mode: 'CW' };

    resetRigState(ctx);

    expect(ctx.vfoSupported).toBe(true);
    expect(ctx.powerSupported).toBe(false);
    expect(ctx.powerState).toBe('unknown');
    expect(ctx.powerOpInProgress).toBe(false);
    expect(ctx.lastPowerCheck).toBe(0);
    expect(ctx.powerOffProbeFailureCount).toBe(0);
    expect(ctx.pendingCapabilityProbe).toBe(false);
    expect(ctx.knownPoweredOff).toBe(false);
    expect(ctx.lastStatus).toEqual({
      frequency: '14074000',
      mode: 'USB',
      bandwidth: '2400',
      ptt: false,
      smeter: -54,
      swr: 1.0,
      alc: 0,
      powerMeter: 0,
      rfpower: 0.5,
      vdd: 13.8,
      vfo: 'VFOA',
      isSplit: false,
      txVFO: 'VFOB',
      rfLevel: 0,
      agc: 6,
      attenuation: 0,
      preamp: 0,
      nb: false,
      nbLevel: 0,
      nr: false,
      nrLevel: 8 / 15,
      anf: false,
      tuner: false,
      powerState: 'unknown',
      powerPending: false,
    });
  });
});
