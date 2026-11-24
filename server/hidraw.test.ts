// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hidrawNumber, isCm108Compatible, parseHidUevent, resolveCm108Path, sortHidrawNames } from './hidraw.ts';

describe('isCm108Compatible', () => {
  it('matches the C-Media CM108 family and SSS1621/23 IDs Hamlib accepts', () => {
    expect(isCm108Compatible(0x0d8c, 0x000c)).toBe(true);
    expect(isCm108Compatible(0x0d8c, 0x0008)).toBe(true);
    expect(isCm108Compatible(0x0d8c, 0x013c)).toBe(true);
    expect(isCm108Compatible(0x0c76, 0x1607)).toBe(true);
  });

  it('rejects other devices', () => {
    expect(isCm108Compatible(0x0d8c, 0x0010)).toBe(false);
    expect(isCm108Compatible(0x046d, 0xc52b)).toBe(false);
    expect(isCm108Compatible(0x0c76, 0x0001)).toBe(false);
  });
});

describe('parseHidUevent', () => {
  it('reads the vendor/product IDs and collapses the padded name', () => {
    const text = [
      'DRIVER=hid-generic',
      'HID_ID=0003:00000D8C:0000000C',
      'HID_NAME=C-Media Electronics Inc.       USB Audio Device',
      'HID_PHYS=usb-0000:00:14.0-2/input3',
    ].join('\n');
    expect(parseHidUevent(text)).toEqual({ vendor: 0x0d8c, product: 0x000c, name: 'C-Media Electronics Inc. USB Audio Device' });
  });

  it('returns null without a HID_ID line', () => {
    expect(parseHidUevent('DRIVER=usbhid\n')).toBeNull();
  });
});

describe('hidraw name helpers', () => {
  it('parses and sorts numerically, ignoring non-hidraw entries', () => {
    expect(hidrawNumber('hidraw10')).toBe(10);
    expect(hidrawNumber('hiddev0')).toBeNull();
    expect(sortHidrawNames(['hidraw10', 'hidraw2', 'foo', 'hidraw0'])).toEqual(['hidraw0', 'hidraw2', 'hidraw10']);
  });
});

describe('resolveCm108Path', () => {
  const dev = (n: number) => ({ path: `/dev/hidraw${n}`, label: `d${n}` });

  it('passes an explicit path through untouched', async () => {
    expect(await resolveCm108Path('/dev/hidraw5', async () => [], 'linux')).toEqual({ path: '/dev/hidraw5' });
  });

  it('passes auto through on Windows and macOS for Hamlib to resolve', async () => {
    expect(await resolveCm108Path('auto', async () => [], 'win32')).toEqual({ path: 'auto' });
    expect(await resolveCm108Path(undefined, async () => [], 'darwin')).toEqual({ path: 'auto' });
  });

  it('resolves auto to the only device on Linux', async () => {
    expect(await resolveCm108Path('auto', async () => [dev(3)], 'linux')).toEqual({ path: '/dev/hidraw3' });
  });

  it('errors on Linux with zero or several devices', async () => {
    expect(await resolveCm108Path('auto', async () => [], 'linux')).toHaveProperty('error');
    const many = await resolveCm108Path('', async () => [dev(1), dev(2)], 'linux');
    expect(many).toHaveProperty('error');
    expect((many as { error: string }).error).toContain('/dev/hidraw1');
  });
});
