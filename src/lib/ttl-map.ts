/** Bounded map with per-entry TTL expiry and LRU-style eviction at capacity. */
export class TtlMap<K, V> {
  private map = new Map<K, { v: V; ts: number }>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
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
    if (this.map.size >= this.maxSize && !this.map.has(key)) {
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
}
