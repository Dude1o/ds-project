import type { HashRing } from '@/types';
import { hashCode } from './hashCode';

/**
 * Consistent hashing ring with virtual nodes.
 * Distributed systems concept: consistent hashing minimises key redistribution when
 * nodes join/leave. Virtual nodes (vnodes) improve distribution balance across the ring.
 * Used by ConsistentHashBalancer and the sharding visualisation.
 */
export class ConsistentHashRing {
  private virtualNodes: number;
  /** Sorted array of ring positions. */
  private positions: number[] = [];
  /** position → nodeId */
  private ring: Map<number, string> = new Map();
  private nodeSet: Set<string> = new Set();

  constructor(virtualNodes: number) {
    if (virtualNodes <= 0) {
      throw new Error('ConsistentHashRing: virtualNodes must be >= 1');
    }
    this.virtualNodes = virtualNodes;
  }

  /** Adds a node to the ring, placing `virtualNodes` replicas at hashed positions. */
  addNode(nodeId: string): void {
    if (this.nodeSet.has(nodeId)) return;
    this.nodeSet.add(nodeId);
    for (let i = 0; i < this.virtualNodes; i++) {
      const position = hashCode(`${nodeId}:vnode:${i}`);
      // Dedup guard: if a previous vnode (from another node or an earlier
      // iteration of this same node) already occupies this position, skip
      // the push to positions[]. Without this guard, a collision would
      // produce a duplicate positions[] entry whose ring mapping may later
      // be overwritten/deleted on removeNode of the colliding node, leaving
      // a dangling position where ring.get(pos)! returns undefined and
      // crashes getNode(). We still ring.set so this node records ownership
      // of the colliding position (last-writer-wins on that single slot).
      if (!this.ring.has(position)) {
        this.positions.push(position);
      }
      this.ring.set(position, nodeId);
    }
    this.positions.sort((a, b) => a - b);
  }

  /** Removes a node and all its virtual-node positions from the ring. */
  removeNode(nodeId: string): void {
    if (!this.nodeSet.has(nodeId)) return;
    this.nodeSet.delete(nodeId);
    const nextPositions: number[] = [];
    for (const pos of this.positions) {
      const owner = this.ring.get(pos);
      if (owner === nodeId) {
        this.ring.delete(pos);
      } else {
        nextPositions.push(pos);
      }
    }
    this.positions = nextPositions;
  }

  /** Returns the nodeId responsible for `key` (nearest clockwise position). */
  getNode(key: string): string {
    if (this.positions.length === 0) {
      throw new Error('ConsistentHashRing is empty — add a node first.');
    }
    const hash = hashCode(key);
    // Binary search for the first position >= hash.
    let lo = 0;
    let hi = this.positions.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.positions[mid]! < hash) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const idx = this.positions[lo]! >= hash ? lo : 0;
    const pos = this.positions[idx]!;
    return this.ring.get(pos)!;
  }

  /** Returns a serializable snapshot of the current ring state. */
  getRingSnapshot(): HashRing {
    const ringCopy: Map<number, string> = new Map();
    this.ring.forEach((v, k) => ringCopy.set(k, v));
    return {
      virtualNodes: this.virtualNodes,
      ring: ringCopy,
      nodes: Array.from(this.nodeSet),
    };
  }
}