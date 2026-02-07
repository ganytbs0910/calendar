/* global navigator */

// Weather code to emoji mapping (WMO Weather interpretation codes)
const WEATHER_CODE_MAP: Record<number, string> = {
  0: '☀️',    // Clear sky
  1: '🌤',    // Mainly clear
  2: '⛅️',   // Partly cloudy
  3: '☁️',    // Overcast
  45: '🌫',   // Fog
  48: '🌫',   // Depositing rime fog
  51: '🌦',   // Light drizzle
  53: '🌦',   // Moderate drizzle
  55: '🌧',   // Dense drizzle
  56: '🌧',   // Light freezing drizzle
  57: '🌧',   // Dense freezing drizzle
  61: '🌧',   // Slight rain
  63: '🌧',   // Moderate rain
  65: '🌧',   // Heavy rain
  66: '🌧',   // Light freezing rain
  67: '🌧',   // Heavy freezing rain
  71: '🌨',   // Slight snow fall
  73: '🌨',   // Moderate snow fall
  75: '🌨',   // Heavy snow fall
  77: '🌨',   // Snow grains
  80: '🌧',   // Slight rain showers
  81: '🌧',   // Moderate rain showers
  82: '🌧',   // Violent rain showers
  85: '🌨',   // Slight snow showers
  86: '🌨',   // Heavy snow showers
  95: '⛈',   // Thunderstorm
  96: '⛈',   // Thunderstorm with slight hail
  99: '⛈',   // Thunderstorm with heavy hail
};

export interface WeatherDay {
  icon: string;
  tempMax: number;
}

interface CacheEntry {
  data: Map<string, WeatherDay>;
  timestamp: number;
}

const CACHE_DURATION = 60 * 60 * 1000; // 1 hour
let cache: CacheEntry | null = null;

// Default fallback: Tokyo
const DEFAULT_LAT = 35.6762;
const DEFAULT_LON = 139.6503;

function getWeatherIcon(code: number): string {
  return WEATHER_CODE_MAP[code] || '🌤';
}

async function getCurrentPosition(): Promise<{latitude: number; longitude: number}> {
  return new Promise((resolve) => {
    // Use the global navigator.geolocation (React Native provides this)
    const geo = (navigator as any)?.geolocation;
    if (!geo) {
      resolve({latitude: DEFAULT_LAT, longitude: DEFAULT_LON});
      return;
    }

    geo.getCurrentPosition(
      (position: any) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        // On error, fall back to Tokyo
        resolve({latitude: DEFAULT_LAT, longitude: DEFAULT_LON});
      },
      {enableHighAccuracy: false, timeout: 5000, maximumAge: 60000},
    );
  });
}

export async function fetchWeather(): Promise<Map<string, WeatherDay>> {
  // Check cache
  if (cache && Date.now() - cache.timestamp < CACHE_DURATION) {
    return cache.data;
  }

  try {
    const {latitude, longitude} = await getCurrentPosition();

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Asia/Tokyo&forecast_days=7`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const json = await response.json();
    const result = new Map<string, WeatherDay>();

    if (json.daily) {
      const {time, weathercode, temperature_2m_max} = json.daily;
      for (let i = 0; i < time.length; i++) {
        result.set(time[i], {
          icon: getWeatherIcon(weathercode[i]),
          tempMax: Math.round(temperature_2m_max[i]),
        });
      }
    }

    // Update cache
    cache = {data: result, timestamp: Date.now()};
    return result;
  } catch (error) {
    console.error('Weather fetch error:', error);
    // Return cached data if available, otherwise empty
    return cache?.data || new Map();
  }
}
