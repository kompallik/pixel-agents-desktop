const DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024; // 1 MB

export class LineBuffer {
  private buffer = '';
  private maxBufferSize: number;

  constructor(maxBufferSize = DEFAULT_MAX_BUFFER_SIZE) {
    this.maxBufferSize = maxBufferSize;
  }

  append(chunk: string): string[] {
    this.buffer += chunk;

    // Safety: drop the buffer if it grows beyond max (malformed input)
    if (this.buffer.length > this.maxBufferSize) {
      console.warn('[LineBuffer] Buffer exceeded max size, dropping partial data');
      this.buffer = '';
      return [];
    }

    const parts = this.buffer.split('\n');
    // Last element is either '' (if chunk ended with \n) or a partial line
    this.buffer = parts.pop() ?? '';
    return parts;
  }

  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    return remaining;
  }

  get pending(): number {
    return this.buffer.length;
  }
}
