/* global navigator */

// Weather code to icon name mapping (Ionicons)
const WEATHER_CODE_MAP: Record<number, {name: string; color: string}> = {
  0:  {name: 'sunny-outline',         color: '#FF9500'}, // Clear sky
  1:  {name: 'sunny-outline',         color: '#FF9500'}, // Mainly clear
  2:  {name: 'partly-sunny-outline',  color: '#8E8E93'}, // Partly cloudy
  3:  {name: 'cloudy-outline',        color: '#8E8E93'}, // Overcast
  45: {name: 'cloudy-outline',        color: '#AEAEB2'}, // Fog
  48: {name: 'cloudy-outline',        color: '#AEAEB2'}, // Depositing rime fog
  51: {name: 'rainy-outline',         color: '#5AC8FA'}, // Light drizzle
  53: {name: 'rainy-outline',         color: '#5AC8FA'}, // Moderate drizzle
  55: {name: 'rainy-outline',         color: '#007AFF'}, // Dense drizzle
  56: {name: 'rainy-outline',         color: '#007AFF'}, // Light freezing drizzle
  57: {name: 'rainy-outline',         color: '#007AFF'}, // Dense freezing drizzle
  61: {name: 'rainy-outline',         color: '#5AC8FA'}, // Slight rain
  63: {name: 'rainy-outline',         color: '#007AFF'}, // Moderate rain
  65: {name: 'rainy-outline',         color: '#007AFF'}, // Heavy rain
  66: {name: 'rainy-outline',         color: '#007AFF'}, // Light freezing rain
  67: {name: 'rainy-outline',         color: '#007AFF'}, // Heavy freezing rain
  71: {name: 'snow-outline',          color: '#5AC8FA'}, // Slight snow fall
  73: {name: 'snow-outline',          color: '#5AC8FA'}, // Moderate snow fall
  75: {name: 'snow-outline',          color: '#007AFF'}, // Heavy snow fall
  77: {name: 'snow-outline',          color: '#5AC8FA'}, // Snow grains
  80: {name: 'rainy-outline',         color: '#5AC8FA'}, // Slight rain showers
  81: {name: 'rainy-outline',         color: '#007AFF'}, // Moderate rain showers
  82: {name: 'rainy-outline',         color: '#007AFF'}, // Violent rain showers
  85: {name: 'snow-outline',          color: '#5AC8FA'}, // Slight snow showers
  86: {name: 'snow-outline',          color: '#007AFF'}, // Heavy snow showers
  95: {name: 'thunderstorm-outline',  color: '#FF3B30'}, // Thunderstorm
  96: {name: 'thunderstorm-outline',  color: '#FF3B30'}, // Thunderstorm with slight hail
  99: {name: 'thunderstorm-outline',  color: '#FF3B30'}, // Thunderstorm with heavy hail
};

export interface WeatherDay {
  iconName: string;
  iconColor: string;
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

const DEFAULT_ICON = {name: 'partly-sunny-outline', color: '#8E8E93'};

function getWeatherIcon(code: number): {name: string; color: string} {
  return WEATHER_CODE_MAP[code] || DEFAULT_ICON;
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
        const icon = getWeatherIcon(weathercode[i]);
        result.set(time[i], {
          iconName: icon.name,
          iconColor: icon.color,
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
