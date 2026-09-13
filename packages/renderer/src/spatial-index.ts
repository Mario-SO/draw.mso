import type { DiagramNode } from './index';

/** Broad phase for editor hit tests. Large containers use an overflow list. */
export class SpatialIndex {
  private buckets = new Map<string, Set<string>>();
  private nodes = new Map<string, DiagramNode>();
  private keys = new Map<string, string[]>();
  private overflow = new Set<string>();
  private order = new Map<string, number>();
  private readonly tile = 32;

  update(nodes: readonly DiagramNode[]): void {
    const remaining = new Set(nodes.map(n => n.id));
    for (const id of this.nodes.keys()) if (!remaining.has(id)) this.remove(id);
    nodes.forEach((node, index) => {
      this.order.set(node.id, index);
      const old = this.nodes.get(node.id);
      if (old && old.x === node.x && old.y === node.y && old.width === node.width && old.height === node.height) {
        this.nodes.set(node.id, node); return;
      }
      this.remove(node.id); this.order.set(node.id, index); this.nodes.set(node.id, node);
      const left = Math.floor(node.x / this.tile), right = Math.floor((node.x + node.width) / this.tile);
      const top = Math.floor(node.y / this.tile), bottom = Math.floor((node.y + node.height) / this.tile);
      if ((right - left + 1) * (bottom - top + 1) > 256) { this.overflow.add(node.id); return; }
      const keys: string[] = [];
      for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) {
        const key = `${x},${y}`; keys.push(key);
        let bucket = this.buckets.get(key);
        if (!bucket) this.buckets.set(key, bucket = new Set());
        bucket.add(node.id);
      }
      this.keys.set(node.id, keys);
    });
  }

  at(x: number, y: number): DiagramNode[] {
    const ids = new Set([...this.overflow, ...(this.buckets.get(`${Math.floor(x / this.tile)},${Math.floor(y / this.tile)}`) ?? [])]);
    return [...ids].map(id => this.nodes.get(id)!).filter(n => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height)
      .sort((a, b) => (this.order.get(b.id) ?? 0) - (this.order.get(a.id) ?? 0));
  }

  private remove(id: string): void {
    for (const key of this.keys.get(id) ?? []) {
      const bucket = this.buckets.get(key)!; bucket.delete(id);
      if (!bucket.size) this.buckets.delete(key);
    }
    this.nodes.delete(id); this.keys.delete(id); this.overflow.delete(id); this.order.delete(id);
  }
}
