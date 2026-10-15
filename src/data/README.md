# Offline map data

Country outlines come from `world-atlas` 2.0.2 (Natural Earth source data), and country metadata comes from `world-countries` 5.1.0. Both are installed application dependencies and bundled for offline use.

`detailedRegions.json` replaces the 1:50m Hong Kong (HK) and Macau (MO) outlines with their 1:10m outlines from `world-atlas/countries-10m.json`. Only these two extracted GeoJSON geometries are bundled; the full 1:10m atlas is used only during regeneration. The coordinates and polygon winding come from the same atlas source, and runtime loading applies the existing D3 orientation check. Regenerate it from the repository root with:

```sh
node src/data/generate-detailed-regions.mjs > src/data/detailedRegions.json
```

`supplementalCountries.json` contains the 14 small country and territory geometries that the 1:50m atlas omits. They are extracted from the GeoJSON distributed by `world-countries`. Regenerate it with `node src/data/generate-supplemental-countries.mjs > src/data/supplementalCountries.json`.

`majorCities.json` is a compact extract of [Natural Earth 10m Populated Places](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_populated_places.geojson), which is public domain. It contains Natural Earth's Admin-0 capitals and places with `POP_MAX >= 1,000,000`, including English and Simplified Chinese names when available. To regenerate it, download that source and run:

```sh
node src/data/generate-major-cities.mjs /path/to/ne_10m_populated_places.geojson > src/data/majorCities.json
```
