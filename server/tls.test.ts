// @vitest-environment node
import os from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLanIPs, parseSanIPAddresses } from './tls.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getLanIPs', () => {
  it('returns non-internal IPv4 addresses from every interface', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth0: [
        { address: '192.168.1.50', family: 'IPv4', internal: false } as any,
      ],
      wlan0: [
        { address: '10.0.0.5', family: 'IPv4', internal: false } as any,
      ],
    });

    expect(getLanIPs().sort()).toEqual(['10.0.0.5', '192.168.1.50']);
  });

  it('excludes loopback/internal addresses', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as any],
    });

    expect(getLanIPs()).toEqual([]);
  });

  it('excludes IPv6 addresses', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth0: [{ address: 'fe80::1', family: 'IPv6', internal: false } as any],
    });

    expect(getLanIPs()).toEqual([]);
  });

  it('skips interfaces with no addresses', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth0: undefined,
      wlan0: [{ address: '10.0.0.5', family: 'IPv4', internal: false } as any],
    } as any);

    expect(getLanIPs()).toEqual(['10.0.0.5']);
  });
});

describe('parseSanIPAddresses', () => {
  it('extracts IP Address entries from a comma-separated SAN string', () => {
    const san = 'DNS:localhost, IP Address:127.0.0.1, IP Address:10.0.0.11';
    expect(parseSanIPAddresses(san)).toEqual(new Set(['127.0.0.1', '10.0.0.11']));
  });

  it('does not treat an IP as covered when it is only a substring of another entry', () => {
    const san = 'IP Address:127.0.0.1, IP Address:10.0.0.11';
    const sanIPs = parseSanIPAddresses(san);
    expect(sanIPs.has('10.0.0.11')).toBe(true);
    expect(sanIPs.has('10.0.0.1')).toBe(false);
  });

  it('returns an empty set for an empty or DNS-only SAN', () => {
    expect(parseSanIPAddresses('')).toEqual(new Set());
    expect(parseSanIPAddresses('DNS:localhost')).toEqual(new Set());
  });
});
