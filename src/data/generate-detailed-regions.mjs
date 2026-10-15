// Extract only the small regions that need detailed outlines when zoomed in.
import { feature } from 'topojson-client';
import atlas from 'world-atlas/countries-10m.json' with { type: 'json' };

const codes = new Map([['344', 'HK'], ['446', 'MO']]);
const result = atlas.objects.countries.geometries
  .filter((geometry) => codes.has(String(geometry.id).padStart(3, '0')))
  .map((geometry) => ({
    code: codes.get(String(geometry.id).padStart(3, '0')),
    geometry: feature(atlas, geometry).geometry,
  }));

if (result.length !== codes.size) throw new Error('Missing detailed region geometry');
process.stdout.write(`${JSON.stringify(result)}\n`);
