import { readdir, readFile } from 'node:fs/promises';
const file =
  process.argv[2] ??
  `artifacts/${(await readdir('artifacts'))
    .filter((f) => f.endsWith('.0.001.cpuprofile'))
    .sort()
    .at(-1)}`;
const profile = JSON.parse(await readFile(file, 'utf8')) as {
  nodes: { id: number; callFrame: { functionName: string; url: string }; hitCount: number }[];
  samples: number[];
  timeDeltas: number[];
};
const sums = new Map<number, number>();
profile.samples.forEach((id, i) => sums.set(id, (sums.get(id) ?? 0) + profile.timeDeltas[i]));
console.table(
  profile.nodes
    .map((n) => ({
      name: n.callFrame.functionName,
      url: n.callFrame.url.split('/').slice(-2).join('/'),
      ms: Math.round((sums.get(n.id) ?? 0) / 1000),
    }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 25),
);
