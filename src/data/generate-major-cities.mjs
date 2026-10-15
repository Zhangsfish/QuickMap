// One-time data preparation helper. Run from the repository root with:
// node src/data/generate-major-cities.mjs /path/to/ne_10m_populated_places.geojson
import fs from 'node:fs';
import countries from 'world-countries';

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Pass the Natural Earth populated places GeoJSON path.');

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const alpha2ByAlpha3 = new Map(countries.map((country) => [country.cca3, country.cca2]));
const countryByAlpha2 = new Map(countries.map((country) => [country.cca2, country]));
const exceptionalCodes = new Map([
  ['KOS', 'XK'],
  ['SOL', 'XS'],
]);

const normalizeName = (value) => (value ?? '')
  .normalize('NFKD')
  .replace(/\p{Mark}/gu, '')
  .toLowerCase()
  .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
  .trim();

// Natural Earth has no Yaren point. Nauru has no official capital, but Yaren is
// the de facto seat of government and is the capital named by world-countries.
const supplementalPlaces = [{
  id: 'supplemental-yaren',
  nameEn: 'Yaren',
  nameZh: '亚伦',
  countryCode: 'NR',
  lon: 166.920867,
  lat: -0.5477,
  population: 1_100,
  isCapital: true,
}];

const cities = source.features
  .filter(({ properties }) =>
    properties.FEATURECLA?.startsWith('Admin-0') || properties.POP_MAX >= 1_000_000,
  )
  .map(({ properties, geometry }) => {
    const countryCode =
      properties.ISO_A2 !== '-99'
        ? properties.ISO_A2
        : alpha2ByAlpha3.get(properties.ADM0_A3) ?? exceptionalCodes.get(properties.ADM0_A3);
    const metadata = countryByAlpha2.get(countryCode);
    const placeNames = [properties.NAME, properties.NAME_EN, properties.NAMEASCII].map(normalizeName);
    const matchesCurrentCapital = metadata?.capital.some((capital) =>
      placeNames.includes(normalizeName(capital)),
    );
    const isCapital = matchesCurrentCapital || (properties.ADM0CAP === 1 && !metadata);
    return {
      id: `ne-${properties.NE_ID}`,
      nameEn: properties.NAME_EN || properties.NAMEASCII || properties.NAME,
      ...(properties.NAME_ZH ? { nameZh: properties.NAME_ZH } : {}),
      countryCode,
      lon: geometry.coordinates[0],
      lat: geometry.coordinates[1],
      population: Math.max(0, properties.POP_MAX || 0),
      ...(isCapital ? { isCapital: true } : {}),
    };
  })
  .filter((city) => city.countryCode)
  .concat(supplementalPlaces)
  .sort((a, b) => a.countryCode.localeCompare(b.countryCode) || b.population - a.population || a.nameEn.localeCompare(b.nameEn));

process.stdout.write(`${JSON.stringify(cities, null, 2)}\n`);
