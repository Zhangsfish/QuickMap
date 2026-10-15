import type { FeatureCollection, Geometry } from 'geojson';
import { geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import atlas from 'world-atlas/countries-50m.json';
import countryMetadata from 'world-countries';
import type { CityRecord, CountryRecord, PlaceMatch } from '../shared/types';
import cityData from './majorCities.json';
import supplementalCountryData from './supplementalCountries.json';

type CountryMetadata = (typeof countryMetadata)[number];

type FallbackCountry = {
  code: string;
  nameEn: string;
  nameZh: string;
  capitalEn?: string;
  capitalZh?: string;
  neighbors: string[];
  lon: number;
  lat: number;
};

const fallbackCountries: Record<string, FallbackCountry> = {
  Kosovo: {
    code: 'XK',
    nameEn: 'Kosovo',
    nameZh: '科索沃',
    capitalEn: 'Pristina',
    capitalZh: '普里什蒂纳',
    neighbors: ['AL', 'ME', 'MK', 'RS'],
    lon: 21.1662,
    lat: 42.6639,
  },
  Somaliland: {
    code: 'XS',
    nameEn: 'Somaliland',
    nameZh: '索马里兰',
    capitalEn: 'Hargeisa',
    capitalZh: '哈尔格萨',
    neighbors: ['DJ', 'ET', 'SO'],
    lon: 44.064,
    lat: 9.56,
  },
  'N. Cyprus': {
    code: 'XN',
    nameEn: 'Northern Cyprus',
    nameZh: '北塞浦路斯',
    capitalEn: 'North Nicosia',
    capitalZh: '北尼科西亚',
    neighbors: ['CY'],
    lon: 33.3639,
    lat: 35.1856,
  },
  'Indian Ocean Ter.': {
    code: 'XI',
    nameEn: 'Indian Ocean Territories',
    nameZh: '印度洋领地',
    neighbors: [],
    lon: 72.4,
    lat: -7.3,
  },
  'Siachen Glacier': {
    code: 'XG',
    nameEn: 'Siachen Glacier',
    nameZh: '锡亚琴冰川',
    neighbors: ['CN', 'IN', 'PK'],
    lon: 76.9,
    lat: 35.4,
  },
};

const metadataByNumericCode = new Map(
  countryMetadata.map((country) => [country.ccn3, country] as const),
);
const alpha2ByAlpha3 = new Map(
  countryMetadata.map((country) => [country.cca3, country.cca2] as const),
);
const metadataByAlpha2 = new Map(
  countryMetadata.map((country) => [country.cca2, country] as const),
);

export const cities: CityRecord[] = cityData as CityRecord[];

const citiesByCountry = new Map<string, CityRecord[]>();
for (const city of cities) {
  const code = city.countryCode.toUpperCase();
  const countryCities = citiesByCountry.get(code) ?? [];
  countryCities.push(city);
  citiesByCountry.set(code, countryCities);
}
for (const countryCities of citiesByCountry.values()) {
  countryCities.sort(
    (a, b) => Number(Boolean(b.isCapital)) - Number(Boolean(a.isCapital)) ||
      (b.population ?? 0) - (a.population ?? 0) ||
      a.nameEn.localeCompare(b.nameEn),
  );
}

const normalized = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[\p{Punctuation}\p{Symbol}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const findCapital = (metadata: CountryMetadata): CityRecord | undefined => {
  const countryCities = citiesByCountry.get(metadata.cca2) ?? [];
  const preferredName = normalized(metadata.capital[0] ?? '');
  return (
    countryCities.find(
      (city) => city.isCapital && normalized(city.nameEn) === preferredName,
    ) ?? countryCities.find((city) => city.isCapital)
  );
};

const countryFromMetadata = (
  metadata: CountryMetadata,
  geometry: Geometry,
): CountryRecord => {
  const capital = findCapital(metadata);
  return {
    id: `country-${metadata.cca2}`,
    code: metadata.cca2,
    nameEn: metadata.name.common,
    nameZh: metadata.translations.zho?.common ?? metadata.name.common,
    capitalEn: metadata.capital[0],
    capitalZh: capital?.nameZh,
    neighbors: metadata.borders
      .map((code) => alpha2ByAlpha3.get(code))
      .filter((code): code is string => Boolean(code)),
    lon: capital?.lon ?? metadata.latlng[1],
    lat: capital?.lat ?? metadata.latlng[0],
    geometry,
  };
};

const combineGeometry = (first: Geometry, second: Geometry): Geometry => ({
  type: 'GeometryCollection',
  geometries: [
    ...(first.type === 'GeometryCollection' ? first.geometries : [first]),
    ...(second.type === 'GeometryCollection' ? second.geometries : [second]),
  ],
});

const reversePolygonRings = (geometry: Geometry): Geometry => {
  if (geometry.type === 'Polygon') {
    return { ...geometry, coordinates: geometry.coordinates.map((ring) => [...ring].reverse()) };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => [...ring].reverse()),
      ),
    };
  }
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map(reversePolygonRings) };
  }
  return geometry;
};

const orientForD3 = (geometry: Geometry): Geometry =>
  geoArea(geometry) > 2 * Math.PI ? reversePolygonRings(geometry) : geometry;

const atlasTopology = atlas as unknown as Topology;
const atlasGeometryCollection = atlasTopology.objects.countries as GeometryCollection;
const atlasFeatures = feature(
  atlasTopology,
  atlasGeometryCollection,
) as FeatureCollection<Geometry, { name?: string }>;

const atlasCountries: CountryRecord[] = atlasFeatures.features.map((atlasFeature) => {
  const numericCode = atlasFeature.id == null
    ? undefined
    : String(atlasFeature.id).padStart(3, '0');
  const metadata = numericCode == null ? undefined : metadataByNumericCode.get(numericCode);

  if (metadata) {
    return countryFromMetadata(metadata, atlasFeature.geometry);
  }

  const atlasName = atlasFeature.properties?.name ?? 'Unknown territory';
  const fallback = fallbackCountries[atlasName] ?? {
    code: `X${String(atlasFeature.id ?? atlasName).slice(0, 1).toUpperCase()}`,
    nameEn: atlasName,
    nameZh: atlasName,
    neighbors: [],
    lon: 0,
    lat: 0,
  };
  return {
    id: `country-${fallback.code}`,
    ...fallback,
    geometry: atlasFeature.geometry,
  };
});

const countriesByCode = new Map<string, CountryRecord>();
for (const country of atlasCountries) {
  const existing = countriesByCode.get(country.code);
  countriesByCode.set(
    country.code,
    existing
      ? { ...existing, geometry: combineGeometry(existing.geometry, country.geometry) }
      : country,
  );
}
for (const supplemental of supplementalCountryData as Array<{ code: string; geometry: Geometry }>) {
  const metadata = metadataByAlpha2.get(supplemental.code);
  if (metadata && !countriesByCode.has(metadata.cca2)) {
    countriesByCode.set(
      metadata.cca2,
      countryFromMetadata(metadata, orientForD3(supplemental.geometry)),
    );
  }
}

export const countries: CountryRecord[] = [...countriesByCode.values()].sort((a, b) =>
  a.nameEn.localeCompare(b.nameEn),
);

const countryByCode = new Map(countries.map((country) => [country.code, country]));

type SearchEntry = {
  match: PlaceMatch;
  terms: string[];
  population: number;
};

const searchEntries: SearchEntry[] = [
  ...countries.map((country): SearchEntry => {
    const metadata = metadataByAlpha2.get(country.code);
    const terms = [
      country.nameEn,
      country.nameZh,
      country.code,
      metadata?.cca3,
      metadata?.name.official,
      metadata?.translations.zho?.official,
      ...(metadata?.altSpellings ?? []),
    ].filter((term): term is string => Boolean(term));
    return {
      match: {
        id: country.id,
        label: country.nameZh === country.nameEn
          ? country.nameEn
          : `${country.nameEn} / ${country.nameZh}`,
        kind: 'country',
        lon: country.lon,
        lat: country.lat,
        countryCode: country.code,
      },
      terms: [...new Set(terms.map(normalized).filter(Boolean))],
      population: Number.MAX_SAFE_INTEGER,
    };
  }),
  ...cities.map((city): SearchEntry => {
    const country = countryByCode.get(city.countryCode);
    const cityLabel = city.nameZh && city.nameZh !== city.nameEn
      ? `${city.nameEn} / ${city.nameZh}`
      : city.nameEn;
    const countryLabel = country
      ? country.nameZh === country.nameEn
        ? country.nameEn
        : `${country.nameEn} / ${country.nameZh}`
      : city.countryCode;
    return {
      match: {
        id: city.id,
        label: `${cityLabel} · ${countryLabel}`,
        kind: 'city',
        lon: city.lon,
        lat: city.lat,
        countryCode: city.countryCode,
      },
      terms: [...new Set([city.nameEn, city.nameZh].filter((term): term is string => Boolean(term)).map(normalized))],
      population: city.population ?? 0,
    };
  }),
];

const matchScore = (term: string, query: string): number | undefined => {
  if (term === query) return 0;
  if (term.startsWith(query)) return 1;
  if (term.split(' ').some((word) => word.startsWith(query))) return 2;
  if (term.includes(query)) return 3;
  return undefined;
};

export function findPlaces(query: string): PlaceMatch[] {
  const wanted = normalized(query);
  if (!wanted) return [];

  return searchEntries
    .map((entry) => ({
      entry,
      score: Math.min(
        ...entry.terms.map((term) => matchScore(term, wanted) ?? Number.POSITIVE_INFINITY),
      ),
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort(
      (a, b) => a.score - b.score ||
        Number(a.entry.match.kind === 'city') - Number(b.entry.match.kind === 'city') ||
        b.entry.population - a.entry.population ||
        a.entry.match.label.localeCompare(b.entry.match.label),
    )
    .slice(0, 20)
    .map(({ entry }) => entry.match);
}

export function getCountryCities(code: string): CityRecord[] {
  return [...(citiesByCountry.get(code.trim().toUpperCase()) ?? [])];
}
