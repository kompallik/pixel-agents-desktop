import { describe, it, expect } from 'vitest';
import { LineBuffer } from './lineBuffer.js';

describe('LineBuffer', () => {
  it('returns complete lines from append', () => {
    const buf = new LineBuffer();
    const lines = buf.append('hello\nworld\n');
    expect(lines).toEqual(['hello', 'world']);
  });

  it('buffers partial lines', () => {
    const buf = new LineBuffer();
    const lines = buf.append('hello');
    expect(lines).toEqual([]);
    expect(buf.pending).toBe(5);
  });

  it('flush returns and clears partial', () => {
    const buf = new LineBuffer();
    buf.append('partial');
    const remaining = buf.flush();
    expect(remaining).toBe('partial');
    expect(buf.pending).toBe(0);
  });

  it('handles multiple newlines in one chunk', () => {
    const buf = new LineBuffer();
    const lines = buf.append('a\nb\nc\nd\n');
    expect(lines).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles empty input', () => {
    const buf = new LineBuffer();
    const lines = buf.append('');
    expect(lines).toEqual([]);
    expect(buf.pending).toBe(0);
  });

  it('joins partial lines across appends', () => {
    const buf = new LineBuffer();
    expect(buf.append('hel')).toEqual([]);
    expect(buf.append('lo\n')).toEqual(['hello']);
  });

  it('drops buffer when exceeding max size', () => {
    const buf = new LineBuffer(10);
    const lines = buf.append('x'.repeat(20));
    expect(lines).toEqual([]);
    expect(buf.pending).toBe(0);
  });
});
