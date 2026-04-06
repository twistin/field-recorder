import type { AutomaticWeatherSummary } from '../types/fieldSessions';

interface OpenMeteoCurrentResponse {
  current?: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
    precipitation: number;
    is_day: number;
  };
}

function getWeatherCodeLabel(code: number, isDay: boolean): string {
  switch (code) {
    case 0:
      return isDay ? 'Cielo despejado' : 'Cielo despejado nocturno';
    case 1:
      return 'Mayormente despejado';
    case 2:
      return 'Parcialmente nuboso';
    case 3:
      return 'Cubierto';
    case 45:
    case 48:
      return 'Niebla';
    case 51:
    case 53:
    case 55:
      return 'Llovizna';
    case 56:
    case 57:
      return 'Llovizna helada';
    case 61:
    case 63:
    case 65:
      return 'Lluvia';
    case 66:
    case 67:
      return 'Lluvia helada';
    case 71:
    case 73:
    case 75:
      return 'Nieve';
    case 77:
      return 'Granizo fino';
    case 80:
    case 81:
    case 82:
      return 'Chubascos';
    case 85:
    case 86:
      return 'Chubascos de nieve';
    case 95:
      return 'Tormenta';
    case 96:
    case 99:
      return 'Tormenta con granizo';
    default:
      return 'Condición variable';
  }
}

export async function fetchAutomaticWeather(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<AutomaticWeatherSummary> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,is_day',
    timezone: 'auto',
    forecast_days: '1',
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    signal,
  });

  if (!response.ok) {
    throw new Error(`Weather request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as OpenMeteoCurrentResponse;
  if (!payload.current) {
    throw new Error('Weather API did not return current conditions.');
  }

  const label = getWeatherCodeLabel(payload.current.weather_code, payload.current.is_day === 1);
  const temperature = Math.round(payload.current.temperature_2m);
  const apparent = Math.round(payload.current.apparent_temperature);
  const wind = Math.round(payload.current.wind_speed_10m);
  const precipitation =
    payload.current.precipitation >= 0.1 ? ` · precip. ${payload.current.precipitation.toFixed(1)} mm` : '';

  return {
    summary: `${label}, ${temperature} °C, viento ${wind} km/h`,
    details: `Sensación ${apparent} °C${precipitation}`,
    fetchedAt: payload.current.time,
  };
}
