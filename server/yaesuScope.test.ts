// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { guardLineBufferSize } from './yaesuScope.ts';

describe('guardLineBufferSize', () => {
  it('passes a buffer under the cap through unchanged', () => {
    const result = guardLineBufferSize('a'.repeat(100), 200);
    expect(result).toEqual({ buffer: 'a'.repeat(100), wasReset: false });
  });

  it('passes a buffer exactly at the cap through unchanged', () => {
    const result = guardLineBufferSize('a'.repeat(200), 200);
    expect(result).toEqual({ buffer: 'a'.repeat(200), wasReset: false });
  });

  it('resets a buffer over the cap to empty', () => {
    const result = guardLineBufferSize('a'.repeat(201), 200);
    expect(result).toEqual({ buffer: '', wasReset: true });
  });

  it('uses the default cap when maxBytes is omitted', () => {
    expect(guardLineBufferSize('a'.repeat(8192)).wasReset).toBe(false);
    expect(guardLineBufferSize('a'.repeat(8193)).wasReset).toBe(true);
  });
});
