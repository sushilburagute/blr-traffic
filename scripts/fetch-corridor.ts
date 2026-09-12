import { mkdir, writeFile } from 'node:fs/promises';
const query =
  '[out:json][timeout:90];(way[highway~"^(trunk|primary|secondary|trunk_link|primary_link|secondary_link)$"](12.90,77.615,12.966,77.712);node[highway=traffic_signals](12.90,77.615,12.966,77.712););out body;>;out skel qt;';
await mkdir('src/data/corridor', { recursive: true });
let saved = false;
for (const endpoint of [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]) {
  try {
    console.log(`Fetching OSM from ${endpoint}`);
    // Overpass answers a bare GET (no User-Agent) with 406; POST the query as a form body instead.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'blr-traffic-sim/0.1 (https://blr-traffic.sush.dev; corridor data fetch)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { elements?: unknown[] };
    if (!data.elements?.length) throw new Error('Empty OSM response');
    await writeFile('src/data/corridor/raw-overpass.json', JSON.stringify(data));
    console.log(`Saved ${data.elements.length} OSM elements`);
    saved = true;
    break;
  } catch (error) {
    console.warn(String(error));
  }
}
if (!saved)
  throw new Error('Both Overpass mirrors failed. Existing committed data was left untouched.');
