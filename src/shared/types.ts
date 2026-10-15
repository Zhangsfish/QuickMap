import type { Geometry } from 'geojson';

export type CountryRecord = {
  id: string;
  code: string;
  nameEn: string;
  nameZh: string;
  capitalEn?: string;
  capitalZh?: string;
  neighbors: string[];
  lon: number;
  lat: number;
  geometry: Geometry;
};

export type CityRecord = {
  id: string;
  nameEn: string;
  nameZh?: string;
  countryCode: string;
  lon: number;
  lat: number;
  population?: number;
  isCapital?: boolean;
};

export type PlaceMatch = {
  id: string;
  label: string;
  kind: 'country' | 'city';
  lon: number;
  lat: number;
  countryCode?: string;
};
