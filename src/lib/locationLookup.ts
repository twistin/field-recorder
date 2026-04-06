import type { DetectedPlaceSummary } from '../types/fieldSessions';

interface ReverseGeocodeResponse {
  name?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
}

function pickFirstDefined(values: Array<string | undefined>): string {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
}

export async function reverseGeocodePlace(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<DetectedPlaceSummary> {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: latitude.toString(),
    lon: longitude.toString(),
    zoom: '16',
    addressdetails: '1',
    'accept-language': 'es',
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Reverse geocoding failed with status ${response.status}`);
  }

  const payload = (await response.json()) as ReverseGeocodeResponse;
  const address = payload.address ?? {};

  const placeName = pickFirstDefined([
    payload.name,
    address.hamlet,
    address.locality,
    address.neighbourhood,
    address.suburb,
    address.village,
    address.town,
    address.city,
    address.road,
    payload.display_name,
  ]);

  const context = [
    pickFirstDefined([address.road, address.neighbourhood, address.suburb, address.hamlet]),
    pickFirstDefined([address.village, address.town, address.city, address.municipality]),
    pickFirstDefined([address.county, address.state, address.region]),
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    placeName,
    context,
    displayName: payload.display_name?.trim() || placeName,
    fetchedAt: new Date().toISOString(),
  };
}
