import { useState } from 'react';
import { Hash, Layers, Map, Plus, Trash2 } from 'lucide-react';
import { hashCode } from '@/utils/hashing/hashCode';
import { getHashShard, getRangeShard, DirectoryShardRouter } from '@/utils/sharding';
import type { RangePartition } from '@/utils/sharding';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const SHARD_IDS = ['shard-0', 'shard-1', 'shard-2'];

const RANGE_PARTITIONS: RangePartition[] = [
  { shardId: 'shard-A', min: 0, max: 999 },
  { shardId: 'shard-B', min: 1000, max: 1999 },
  { shardId: 'shard-C', min: 2000, max: 9999 },
];

const directory = new DirectoryShardRouter();

interface HashAssignment {
  key: string;
  hash: number;
  shard: string;
}
interface RangeAssignment {
  value: number;
  shard: string;
}

/**
 * ShardingPanel — three sharding strategies side by side.
 * Distributed systems concept: hash, range, and directory sharding each
 * partition the keyspace differently; this panel lets you place keys and
 * observe which shard owns them under each scheme.
 */
export function ShardingPanel() {
  const [hashKey, setHashKey] = useState('');
  const [hashAssignments, setHashAssignments] = useState<HashAssignment[]>([
    { key: 'user:42', hash: hashCode('user:42'), shard: `shard-${getHashShard('user:42', 3)}` },
    { key: 'order:99', hash: hashCode('order:99'), shard: `shard-${getHashShard('order:99', 3)}` },
  ]);

  const [rangeValue, setRangeValue] = useState('');
  const [rangeAssignments, setRangeAssignments] = useState<RangeAssignment[]>([
    { value: 5, shard: getRangeShard(5, RANGE_PARTITIONS) },
    { value: 1500, shard: getRangeShard(1500, RANGE_PARTITIONS) },
  ]);

  const [dirKey, setDirKey] = useState('');
  const [dirShard, setDirShard] = useState('shard-0');
  const [dirEntries, setDirEntries] = useState<Record<string, string>>(() => {
    directory.assign('user:1001', 'shard-0');
    directory.assign('user:1002', 'shard-1');
    return directory.getDirectory();
  });

  const assignHash = () => {
    const key = hashKey.trim();
    if (!key) return;
    const hash = hashCode(key);
    const shard = `shard-${getHashShard(key, 3)}`;
    setHashAssignments((prev) => [{ key, hash, shard }, ...prev.filter((a) => a.key !== key)]);
    setHashKey('');
  };

  const assignRange = () => {
    const n = Number(rangeValue);
    if (Number.isNaN(n)) return;
    try {
      const shard = getRangeShard(n, RANGE_PARTITIONS);
      setRangeAssignments((prev) => [{ value: n, shard }, ...prev.filter((a) => a.value !== n)]);
    } catch {
      /* out of range */
    }
    setRangeValue('');
  };

  const assignDirectory = () => {
    const key = dirKey.trim();
    if (!key) return;
    directory.assign(key, dirShard);
    setDirEntries(directory.getDirectory());
    setDirKey('');
  };

  const reassignDirectory = (key: string, shard: string) => {
    directory.assign(key, shard);
    setDirEntries(directory.getDirectory());
  };

  const removeDirectory = (key: string) => {
    directory.unassign(key);
    setDirEntries(directory.getDirectory());
  };

  const shardBg = ['bg-green-500/15 border-green-900/50', 'bg-indigo-500/15 border-indigo-900/50', 'bg-amber-500/15 border-amber-900/50'];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Hash Sharding */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Hash className="h-4 w-4 text-indigo-400" /> Hash Sharding
          </CardTitle>
          <CardDescription>hashCode(key) % 3 — even, location-independent</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="key, e.g. user:42"
              value={hashKey}
              onChange={(e) => setHashKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && assignHash()}
            />
            <Button size="icon" onClick={assignHash}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            {hashAssignments.map((a) => {
              const idx = SHARD_IDS.indexOf(a.shard);
              return (
                <div key={a.key} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${shardBg[idx] ?? 'border-zinc-800 bg-zinc-900/40'}`}>
                  <div>
                    <div className="font-mono text-zinc-200">{a.key}</div>
                    <div className="font-mono text-[10px] text-zinc-500">hash: {a.hash}</div>
                  </div>
                  <Badge variant="info">{a.shard}</Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Range Sharding */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-indigo-400" /> Range Sharding
          </CardTitle>
          <CardDescription>Contiguous numeric ranges per shard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="value, e.g. 1500"
              value={rangeValue}
              onChange={(e) => setRangeValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && assignRange()}
            />
            <Button size="icon" onClick={assignRange}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1.5 text-[11px] text-zinc-500">
            {RANGE_PARTITIONS.map((p) => (
              <div key={p.shardId} className="flex justify-between font-mono">
                <span>{p.shardId}</span>
                <span>[{p.min}–{p.max}]</span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {rangeAssignments.map((a) => (
              <div key={a.value} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
                <span className="font-mono text-zinc-200">{a.value}</span>
                <Badge variant="info">{a.shard}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Directory Sharding */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Map className="h-4 w-4 text-indigo-400" /> Directory Sharding
          </CardTitle>
          <CardDescription>Explicit key→shard lookup table (editable)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="key"
              value={dirKey}
              onChange={(e) => setDirKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && assignDirectory()}
            />
            <Select value={dirShard} onValueChange={setDirShard}>
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHARD_IDS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="icon" onClick={assignDirectory}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            {Object.keys(dirEntries).length === 0 ? (
              <div className="py-4 text-center text-xs text-zinc-600">No assignments yet.</div>
            ) : (
              Object.entries(dirEntries).map(([key, shard]) => (
                <div key={key} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
                  <span className="font-mono text-zinc-200">{key}</span>
                  <Select value={shard} onValueChange={(v) => reassignDirectory(key, v)}>
                    <SelectTrigger className="ml-auto h-7 w-[100px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SHARD_IDS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => removeDirectory(key)}
                    className="text-zinc-500 hover:text-red-400"
                    aria-label={`remove ${key}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
