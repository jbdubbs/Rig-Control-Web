// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { guardLineBufferSize, splitCompleteLines } from './yaesuScope.ts';

describe('splitCompleteLines', () => {
  it('extracts no lines and returns the whole buffer as remainder when there is no newline', () => {
    expect(splitCompleteLines('partial line')).toEqual({ lines: [], remainder: 'partial line' });
  });

  it('extracts a single complete line and leaves the rest as remainder', () => {
    expect(splitCompleteLines('line1\npartial')).toEqual({ lines: ['line1'], remainder: 'partial' });
  });

  it('extracts several complete lines bundled in one buffer, even when their combined size would exceed a small cap', () => {
    // Regression for the bug fixed alongside this: a single stdout 'data' chunk can
    // legitimately bundle several complete NDJSON frames (Node hands over whatever the
    // pipe delivered, not one line at a time). splitCompleteLines must pull all of them
    // out regardless of total size — only guardLineBufferSize's downstream check on the
    // leftover remainder is allowed to care about size.
    const lines = Array.from({ length: 5 }, (_, i) => `frame-${i}-${'x'.repeat(50)}`);
    const buffer = lines.join('\n') + '\n';
    expect(buffer.length).toBeGreaterThan(200); // exceeds a small illustrative cap below
    const result = splitCompleteLines(buffer);
    expect(result.lines).toEqual(lines);
    expect(result.remainder).toBe('');
    // The remainder (not the original oversized buffer) is what a caller must guard —
    // and it's empty here, so guardLineBufferSize must never reset anything.
    expect(guardLineBufferSize(result.remainder, 200).wasReset).toBe(false);
  });
});

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
