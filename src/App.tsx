import { useState, useRef, useEffect } from 'react';
import {
  MapPin,
  Flag,
  Sun,
  Moon,
  Cloud,
  CloudRain,
  CloudLightning,
  Snowflake,
  CloudSnow,
  NavigationArrow
} from '@phosphor-icons/react'
import * as maplibregl from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import length from '@turf/length';
import along from '@turf/along';
import { lineString } from '@turf/helpers';

// Fix for Vite production build: explicitly set the worker URL so it resolves correctly
maplibregl.setWorkerUrl(mapLibreWorkerUrl);
import 'maplibre-gl/dist/maplibre-gl.css';

const routeSegments = [
  {
    id: "seg_01",
    distanceFromStartMi: 0,
    timeFromStartMins: 0,
    locationName: "San Francisco",
    coordinates: [-122.4194, 37.7749],
    weather: { condition: "Clear", temperatureF: 62, severity: "safe", icon: Sun },
    alert: null
  },
  {
    id: "seg_02",
    distanceFromStartMi: 45,
    timeFromStartMins: 50,
    locationName: "Vacaville",
    coordinates: [-121.9877, 38.3566],
    weather: { condition: "Cloudy", temperatureF: 58, severity: "safe", icon: Cloud },
    alert: null
  },
  {
    id: "seg_03",
    distanceFromStartMi: 85,
    timeFromStartMins: 95,
    locationName: "Sacramento",
    coordinates: [-121.4944, 38.5816],
    weather: { condition: "Rain", temperatureF: 52, severity: "warning", icon: CloudRain },
    alert: "Moderate Rain, Slick Roads"
  },
  {
    id: "seg_04",
    distanceFromStartMi: 130,
    timeFromStartMins: 140,
    locationName: "Auburn",
    coordinates: [-121.0769, 38.8966],
    weather: { condition: "Heavy Rain", temperatureF: 46, severity: "warning", icon: CloudLightning },
    alert: "Heavy Downpour"
  },
  {
    id: "seg_05",
    distanceFromStartMi: 175,
    timeFromStartMins: 190,
    locationName: "Donner Pass",
    coordinates: [-120.3216, 39.3157],
    weather: { condition: "Snow", temperatureF: 28, severity: "critical", icon: Snowflake },
    alert: "Chain Control in Effect"
  },
  {
    id: "seg_06",
    distanceFromStartMi: 210,
    timeFromStartMins: 225,
    locationName: "Lake Tahoe",
    coordinates: [-119.9772, 38.9399],
    weather: { condition: "Light Snow", temperatureF: 22, severity: "critical", icon: CloudSnow },
    alert: "Icy Roads"
  }
];

const rasterDarkMapStyle = {
  version: 8,
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
    }
  },
  layers: [
    {
      id: 'carto-dark-layer',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 22
    }
  ]
};

const rasterLightMapStyle = {
  version: 8,
  sources: {
    'carto-light': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
    }
  },
  layers: [
    {
      id: 'carto-light-layer',
      type: 'raster',
      source: 'carto-light',
      minzoom: 0,
      maxzoom: 22
    }
  ]
};

function App() {
  const mapRef = useRef<MapRef>(null);
  
  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Animation State
  const [routeState, setRouteState] = useState<'hidden' | 'animating' | 'visible'>('hidden');
  const [vehiclePosition, setVehiclePosition] = useState<[number, number] | null>(null);
  const [progress, setProgress] = useState(0); // 0 to 1

  const startAnimation = () => {
    setRouteState('animating');
    setProgress(0);
    setVehiclePosition(routeSegments[0].coordinates as [number, number]);

    // Cinematic zoom to frame the route
    if (mapRef.current) {
      mapRef.current.fitBounds(
        [
          [-122.5, 37.7], // SW corner
          [-119.8, 39.4]  // NE corner
        ],
        { padding: 100, duration: 1500 }
      );
    }
  };

  useEffect(() => {
    if (routeState !== 'animating') return;

    let animationFrame: number;
    let startTime: number | null = null;
    const ANIMATION_DURATION_MS = 6000; // 6 seconds

    // Pre-calculate full route line and distance
    const fullCoordinates = routeSegments.map(s => s.coordinates);
    const routeLine = lineString(fullCoordinates);
    const totalDistance = length(routeLine, { units: 'miles' });

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      
      // Easing function for smooth acceleration/deceleration
      const t = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      const easeInOut = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      setProgress(easeInOut);

      const currentDistance = totalDistance * easeInOut;
      
      if (easeInOut >= 1) {
        setRouteState('visible');
        setVehiclePosition(fullCoordinates[fullCoordinates.length - 1] as [number, number]);
        return;
      }

      // Calculate vehicle position at current distance
      const currentPoint = along(routeLine, currentDistance, { units: 'miles' });
      setVehiclePosition(currentPoint.geometry.coordinates as [number, number]);

      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [routeState]);

  const isDark = theme === 'dark';

  return (
    <div className={`relative w-full h-screen overflow-hidden font-sans flex ${isDark ? 'bg-zinc-950 text-zinc-50' : 'bg-slate-50 text-slate-900'}`}>
      {/* Interactive Map */}
      <div className="absolute inset-0 z-0">
        <Map
          ref={mapRef}
          mapLib={maplibregl}
          initialViewState={{
            longitude: -121.3,
            latitude: 38.5,
            zoom: 7.5,
            pitch: 45
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={(isDark ? rasterDarkMapStyle : rasterLightMapStyle) as any}
        >
          {/* Glowing Route Line Segments (CSP Compliant & Animated) */}
          {(routeState === 'animating' || routeState === 'visible') && routeSegments.slice(0, -1).map((seg, i) => {
            const nextSeg = routeSegments[i + 1];
            const severity = nextSeg.weather.severity;
            
            // Build segment geometry based on animation progress
            const segmentLine = lineString([seg.coordinates, nextSeg.coordinates]);
            const segmentDist = length(segmentLine, { units: 'miles' });
            
            // Calculate how far along the TOTAL route this segment starts and ends
            const prevSegments = routeSegments.slice(0, i + 1);
            const distToStart = i === 0 ? 0 : length(lineString(prevSegments.map(s => s.coordinates)), { units: 'miles' });
            const distToEnd = distToStart + segmentDist;
            
            const totalRouteLine = lineString(routeSegments.map(s => s.coordinates));
            const totalDist = length(totalRouteLine, { units: 'miles' });
            const currentDist = progress * totalDist;

            let segmentCoords: number[][] = [];

            if (currentDist >= distToEnd) {
              // Fully drawn segment
              segmentCoords = [seg.coordinates, nextSeg.coordinates];
            } else if (currentDist > distToStart) {
              // Partially drawn segment
              segmentCoords = [seg.coordinates, vehiclePosition || seg.coordinates];
            } else {
              // Not drawn yet
              return null;
            }

            const glowColor = severity === 'safe' ? '#3b82f6' : severity === 'warning' ? '#f59e0b' : severity === 'critical' ? '#d946ef' : '#a855f7';
            const coreColor = severity === 'safe' ? '#93c5fd' : severity === 'warning' ? '#fcd34d' : severity === 'critical' ? '#f0abfc' : '#d8b4fe';

            const segmentGeoJson = {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: segmentCoords
                  }
                }
              ]
            };

            return (
              <Source key={`source-${seg.id}`} id={`route-${seg.id}`} type="geojson" data={segmentGeoJson as any}>
                <Layer
                  id={`route-line-${seg.id}`}
                  type="line"
                  paint={{
                    'line-color': glowColor,
                    'line-width': 6,
                    'line-opacity': 0.8,
                    'line-blur': 2
                  }}
                />
                <Layer
                  id={`route-line-core-${seg.id}`}
                  type="line"
                  paint={{
                    'line-color': coreColor,
                    'line-width': 2,
                  }}
                />
              </Source>
            );
          })}

          {/* Vehicle Indicator */}
          {vehiclePosition && (
            <Marker
              longitude={vehiclePosition[0]}
              latitude={vehiclePosition[1]}
              anchor="center"
              style={{ zIndex: 50 }}
            >
              <div className="relative flex items-center justify-center pointer-events-none">
                <div className={`absolute w-8 h-8 rounded-full opacity-30 animate-ping ${isDark ? 'bg-zinc-50' : 'bg-slate-900'}`}></div>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.8)] border-2 ${isDark ? 'bg-zinc-50 border-zinc-900' : 'bg-slate-900 border-white'}`}>
                   <NavigationArrow size={12} weight="fill" className={`rotate-45 translate-x-[1px] -translate-y-[1px] ${isDark ? 'text-zinc-900' : 'text-white'}`} />
                </div>
              </div>
            </Marker>
          )}

          {/* Markers for Weather Points */}
          {routeSegments.map((seg, i) => {
            const isSafe = seg.weather.severity === 'safe';
            const isWarning = seg.weather.severity === 'warning';
            
            // Determine if marker should be visible
            let isVisible = false;
            if (routeState === 'hidden') {
              isVisible = true; // Show initial map state
            } else if (routeState === 'visible') {
              isVisible = true; // Show final state
            } else {
              // During animation, only show if vehicle has passed it
              const distToNode = i === 0 ? 0 : length(lineString(routeSegments.slice(0, i + 1).map(s => s.coordinates)), { units: 'miles' });
              const currentDist = progress * length(lineString(routeSegments.map(s => s.coordinates)), { units: 'miles' });
              isVisible = currentDist >= distToNode;
            }
            
            if (!isVisible) return null;

            return (
              <Marker
                key={`marker-${seg.id}`}
                longitude={seg.coordinates[0]}
                latitude={seg.coordinates[1]}
                anchor="bottom"
              >
                <div className={`flex flex-col items-center justify-center -translate-y-2 cursor-pointer transition-transform hover:scale-110 animate-in fade-in zoom-in duration-300
                  ${isSafe ? 'text-blue-400' : isWarning ? 'text-amber-400' : 'text-fuchsia-400'}`}
                >
                  <div className={`backdrop-blur-sm border rounded-lg p-1 shadow-lg flex items-center justify-center mb-1 ${isDark ? 'bg-zinc-900/80 border-zinc-700/50' : 'bg-white/90 border-slate-200'}`}>
                     <seg.weather.icon size={20} weight="duotone" />
                  </div>
                  <div className={`w-1.5 h-1.5 rounded-full bg-current shadow-[0_0_10px_currentColor] ${isDark ? '' : 'border border-white/50'}`}></div>
                </div>
              </Marker>
            );
          })}
        </Map>
      </div>

      {/* Sidebar Dashboard (Layered on top of map) */}
      <div className="absolute top-0 left-0 w-full md:w-[400px] h-full flex flex-col p-4 md:p-6 z-10 pointer-events-none">
        
        {/* Header with Theme Toggle */}
        <div className="pointer-events-auto flex justify-end mb-2">
          <button 
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={`p-2 rounded-full backdrop-blur-md border shadow-lg transition-colors cursor-pointer hover:scale-105 active:scale-95
              ${isDark ? 'bg-zinc-900/80 border-zinc-800 text-amber-400 hover:bg-zinc-800' : 'bg-white/90 border-slate-200 text-indigo-500 hover:bg-slate-50'}`}
            aria-label="Toggle theme"
          >
            {isDark ? <Sun size={20} weight="fill" /> : <Moon size={20} weight="fill" />}
          </button>
        </div>

        {/* Input Panel */}
        <div className={`pointer-events-auto backdrop-blur-xl border rounded-2xl p-5 mb-4 shadow-2xl flex-shrink-0 transition-colors duration-300
          ${isDark ? 'bg-zinc-900/80 border-zinc-800' : 'bg-white/90 border-slate-200'}`}>
          <div className="flex flex-col gap-3">
            <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border border-transparent transition-colors
              ${isDark ? 'bg-zinc-800/50 focus-within:border-zinc-700' : 'bg-slate-100 focus-within:border-slate-300'}`}>
              <MapPin size={20} className={isDark ? 'text-zinc-400' : 'text-slate-400'} />
              <input type="text" defaultValue="San Francisco, CA" className={`bg-transparent border-none outline-none text-sm w-full font-medium ${isDark ? 'text-zinc-50' : 'text-slate-900'}`} />
            </div>
            <div className={`w-[1px] h-3 ml-6 ${isDark ? 'bg-zinc-700' : 'bg-slate-300'}`}></div>
            <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border border-transparent transition-colors
              ${isDark ? 'bg-zinc-800/50 focus-within:border-zinc-700' : 'bg-slate-100 focus-within:border-slate-300'}`}>
              <Flag size={20} className={isDark ? 'text-zinc-400' : 'text-slate-400'} />
              <input type="text" defaultValue="Lake Tahoe, CA" className={`bg-transparent border-none outline-none text-sm w-full font-medium ${isDark ? 'text-zinc-50' : 'text-slate-900'}`} />
            </div>
          </div>
          
          <div className={`mt-5 pt-4 border-t flex justify-between items-end ${isDark ? 'border-zinc-800' : 'border-slate-200'}`}>
            <div>
              <div className="text-3xl font-bold tracking-tight">4h 15m</div>
              <div className={`text-sm font-mono mt-1 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>210 mi • ETA 8:30 PM</div>
            </div>
            <button 
              onClick={startAnimation}
              disabled={routeState === 'animating'}
              className={`font-medium px-4 py-2 rounded-full text-sm transition-colors active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
                ${isDark ? 'bg-zinc-100 text-zinc-900 hover:bg-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
            >
              {routeState === 'animating' ? 'Navigating...' : routeState === 'visible' ? 'Recalculate' : 'Leave Now'}
            </button>
          </div>
        </div>

        {/* Timeline (Scrollable) */}
        <div className={`pointer-events-auto flex-1 overflow-y-auto no-scrollbar backdrop-blur-xl border rounded-2xl p-5 shadow-2xl transition-colors duration-300
          ${isDark ? 'bg-zinc-900/80 border-zinc-800' : 'bg-white/90 border-slate-200'}`}>
          <h2 className={`text-sm font-semibold uppercase tracking-widest mb-6 px-2 ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}>Weather Route</h2>
          
          <div className="relative pl-6">
            {/* Connecting line */}
            <div className={`absolute top-4 bottom-4 left-[11px] w-[2px] rounded-full ${isDark ? 'bg-zinc-800' : 'bg-slate-200'}`}></div>
            
            <div className="flex flex-col gap-8">
              {routeSegments.map((seg, i) => {
                const Icon = seg.weather.icon;
                const isSafe = seg.weather.severity === 'safe';
                const isWarning = seg.weather.severity === 'warning';
                
                // Dim timeline items if they haven't been reached yet during animation
                const distToNode = i === 0 ? 0 : length(lineString(routeSegments.slice(0, i + 1).map(s => s.coordinates)), { units: 'miles' });
                const currentDist = progress * length(lineString(routeSegments.map(s => s.coordinates)), { units: 'miles' });
                const isReached = routeState === 'hidden' || currentDist >= distToNode || routeState === 'visible';

                return (
                  <div key={seg.id} className={`relative transition-opacity duration-500 ${isReached ? 'opacity-100' : 'opacity-30'}`}>
                    {/* Node */}
                    <div className={`absolute -left-6 w-3 h-3 rounded-full border-2 mt-1.5 z-10 
                      ${isDark ? 'border-zinc-900' : 'border-white'}
                      ${isSafe ? 'bg-blue-500' : isWarning ? 'bg-amber-500' : 'bg-fuchsia-500'}`}>
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-baseline">
                        <h3 className={`font-medium ${isDark ? 'text-zinc-100' : 'text-slate-800'}`}>{seg.locationName}</h3>
                        <span className={`text-xs font-mono ${isDark ? 'text-zinc-500' : 'text-slate-400'}`}>+{seg.timeFromStartMins}m</span>
                      </div>
                      
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-2">
                          <Icon size={24} className={isSafe ? 'text-blue-500' : isWarning ? 'text-amber-500' : 'text-fuchsia-500'} weight="duotone" />
                          <span className={`font-mono text-lg ${isDark ? 'text-zinc-50' : 'text-slate-900'}`}>{seg.weather.temperatureF}°</span>
                        </div>
                        <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>{seg.weather.condition}</span>
                      </div>

                      {seg.alert && (
                        <div className={`mt-3 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium self-start
                          ${isWarning ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' : 
                          'bg-fuchsia-500/10 text-fuchsia-600 border border-fuchsia-500/20'}`}>
                          {seg.alert}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

export default App
