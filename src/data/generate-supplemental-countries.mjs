// One-time preparation helper for countries omitted by world-atlas at 1:50m.
import fs from 'node:fs';
import countries from 'world-countries';
import atlas from 'world-atlas/countries-50m.json' with { type: 'json' };

const representedNumericCodes = new Set(
  atlas.objects.countries.geometries
    .filter((geometry) => geometry.id != null)
    .map((geometry) => String(geometry.id).padStart(3, '0')),
);

const result = countries
  .filter((country) => !representedNumericCodes.has(country.ccn3))
  .map((country) => {
    const source = JSON.parse(
      fs.readFileSync(`node_modules/world-countries/data/${country.cca3.toLowerCase()}.geo.json`, 'utf8'),
    );
    return { code: country.cca2, geometry: source.features[0].geometry };
  });

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
