/**
 * A bounded Map with TTL (time-to-live) eviction.
 * Replaces unbounded module-scope Maps that caused OOM on long-lived processes.
 *
 * Entries older than `ttlMs` are lazily evicted on `get()`.
 * When `maxSize` is exceeded, the oldest entry (insertion order) is evicted.
 */
export class TtlMap<K, V> {
  private map = new Map<K, { v: V; ts: number }>();
  constructor(
    private maxSize: number,
    private ttlMs: number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return entry.v;
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.maxSize) {
      // Evict the oldest entry (first in insertion order)
      this.map.delete(this.map.keys().next().value!);
    }
    this.map.set(key, { v: value, ts: Date.now() });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}
