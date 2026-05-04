export interface HfBandCondition {
  name: string;
  day: string;
  night: string;
}

export interface VhfCondition {
  name: string;
  location: string;
  condition: string;
}

export interface SolarData {
  updated: string;
  solarflux: number;
  sunspots: number;
  aindex: number;
  kindex: number;
  xray: string;
  signalnoise: string;
  geomagfield: string;
  solarwind: number;
  magneticfield: number;
  aurora: number;
  protonflux: number;
  electonflux: number;
  esfi: number | null;
  essn: number | null;
  hfBands: HfBandCondition[];
  vhfConditions: VhfCondition[];
  fetchedAt: number;
}
