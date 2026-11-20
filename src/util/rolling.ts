/**
 * Mean of the last `limit` values pushed, without shifting an array.
 * A ring buffer with a running sum; the sum is rebuilt each lap of the ring
 * so floating-point drift cannot build up.
 */
export class RollingMean {
  private buf: Float64Array;
  private start = 0;
  private len = 0;
  private sum = 0;
  private pushes = 0;

  constructor(capacity: number) {
    this.buf = new Float64Array(Math.max(1, capacity));
  }

  /** Adds a value, then drops the oldest until at most `limit` remain. */
  push(value: number, limit: number): void {
    const cap = this.buf.length;
    const keep = Math.max(1, Math.min(cap, Math.floor(limit)));
    if (this.len === cap) this.dropOldest();
    this.buf[(this.start + this.len) % cap] = value;
    this.len++;
    this.sum += value;
    while (this.len > keep) this.dropOldest();
    if (++this.pushes >= cap) {
      this.pushes = 0;
      let s = 0;
      for (let i = 0; i < this.len; i++) s += this.buf[(this.start + i) % cap];
      this.sum = s;
    }
  }

  get mean(): number {
    return this.len ? this.sum / this.len : 0;
  }

  get size(): number {
    return this.len;
  }

  private dropOldest(): void {
    this.sum -= this.buf[this.start];
    this.start = (this.start + 1) % this.buf.length;
    this.len--;
    if (this.len === 0) this.sum = 0;
  }
}
