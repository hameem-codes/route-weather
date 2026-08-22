import { useState, useRef, useEffect } from 'react';
import {
  MapPin,
  Flag,
  Sun,
  Cloud,
  CloudRain,
  CloudLightning,
  Snowflake,
  CloudSnow,
  NavigationArrow,
  SpinnerGap,
  X,
  Wind,
  Drop,
  Eye,
  CloudCheck,
  Warning,
  ShareNetwork,
  Image as ImageIcon,
  Link,
  Export
} from '@phosphor-icons/react'
import * as maplibregl from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import length from '@turf/length';
import along from '@turf/along';
import lineSlice from '@turf/line-slice';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { toPng } from 'html-to-image';

// Fix for Vite production build: explicitly set the worker URL so it resolves correctly
maplibregl.setWorkerUrl(mapLibreWorkerUrl);

import 'maplibre-gl/dist/maplibre-gl.css';

const hardcodedWeatherProfiles = [
  { 
    weather: { 
      condition: "Clear", temperatureF: 62, severity: "safe", icon: Sun,
      rainProbability: 0, feelsLikeF: 61, humidity: 45, windSpeedMph: 10, windDirection: "NW",
      visibilityMi: 10, precipitationIn: 0, cloudCover: 5, uvIndex: 7,
      forecastText: "Clear skies expected for the next 4 hours.",
      riskAssessment: "Optimal driving conditions."
    }, 
    alert: null 
  },
  { 
    weather: { 
      condition: "Cloudy", temperatureF: 58, severity: "safe", icon: Cloud,
      rainProbability: 10, feelsLikeF: 57, humidity: 60, windSpeedMph: 12, windDirection: "W",
      visibilityMi: 10, precipitationIn: 0, cloudCover: 80, uvIndex: 4,
      forecastText: "Overcast conditions remaining steady.",
      riskAssessment: "Optimal driving conditions."
    }, 
    alert: null 
  },
  { 
    weather: { 
      condition: "Rain", temperatureF: 52, severity: "warning", icon: CloudRain,
      rainProbability: 85, feelsLikeF: 49, humidity: 88, windSpeedMph: 18, windDirection: "SW",
      visibilityMi: 5, precipitationIn: 0.15, cloudCover: 100, uvIndex: 1,
      forecastText: "Continuous rain expected through the afternoon.",
      riskAssessment: "Reduced traction. Increase following distance."
    }, 
    alert: "Moderate Rain, Slick Roads" 
  },
  { 
    weather: { 
      condition: "Heavy Rain", temperatureF: 46, severity: "warning", icon: CloudLightning,
      rainProbability: 100, feelsLikeF: 39, humidity: 95, windSpeedMph: 25, windDirection: "S",
      visibilityMi: 2, precipitationIn: 0.8, cloudCover: 100, uvIndex: 0,
      forecastText: "Heavy downpours with isolated lightning.",
      riskAssessment: "High risk of hydroplaning. Reduce speed significantly."
    }, 
    alert: "Heavy Downpour" 
  },
  { 
    weather: { 
      condition: "Snow", temperatureF: 28, severity: "critical", icon: Snowflake,
      rainProbability: 95, feelsLikeF: 15, humidity: 82, windSpeedMph: 20, windDirection: "NE",
      visibilityMi: 1, precipitationIn: 0.4, cloudCover: 100, uvIndex: 1,
      forecastText: "Steady snowfall accumulation of 2-4 inches expected.",
      riskAssessment: "Severe winter conditions. Chains required on all non-4WD vehicles."
    }, 
    alert: "Chain Control in Effect" 
  },
  { 
    weather: { 
      condition: "Light Snow", temperatureF: 22, severity: "critical", icon: CloudSnow,
      rainProbability: 60, feelsLikeF: 8, humidity: 75, windSpeedMph: 14, windDirection: "N",
      visibilityMi: 4, precipitationIn: 0.1, cloudCover: 90, uvIndex: 2,
      forecastText: "Light flurries tapering off by evening.",
      riskAssessment: "Black ice possible on shaded roadways."
    }, 
    alert: "Icy Roads" 
  }
];

const rasterMapStyle = {
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

function getSlicedCoordinates(coords: number[][], dists: number[], startDist: number, endDist: number) {
  const result: number[][] = [];
  if (coords.length === 0 || startDist >= endDist) return result;
  
  for (let i = 1; i < dists.length; i++) {
    if (dists[i] >= startDist && result.length === 0) {
      if (dists[i] === startDist) {
         result.push([...coords[i]]);
      } else {
         const ratio = (startDist - dists[i-1]) / (dists[i] - dists[i-1]);
         result.push([
           coords[i-1][0] + (coords[i][0] - coords[i-1][0]) * ratio,
           coords[i-1][1] + (coords[i][1] - coords[i-1][1]) * ratio
         ]);
      }
      
      for (let j = i; j < dists.length; j++) {
         if (dists[j] > startDist && dists[j] < endDist) {
           result.push([...coords[j]]);
         }
         if (dists[j] >= endDist) {
           if (dists[j] === endDist) {
             result.push([...coords[j]]);
           } else {
             const endRatio = (endDist - dists[j-1]) / (dists[j] - dists[j-1]);
             result.push([
               coords[j-1][0] + (coords[j][0] - coords[j-1][0]) * endRatio,
               coords[j-1][1] + (coords[j][1] - coords[j-1][1]) * endRatio
             ]);
           }
           break;
         }
      }
      break;
    }
  }
  return result;
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef>(null);
  
  // Input State
  const [originInput, setOriginInput] = useState("San Francisco, CA");
  const [destInput, setDestInput] = useState("Lake Tahoe, CA");
  
  // Route Data State
  const [isLoading, setIsLoading] = useState(false);
  const [routeData, setRouteData] = useState<{
    totalDistanceMi: number;
    totalTimeMins: number;
    routeLine: any;
    cumulativeDistances: number[];
    segments: any[];
  } | null>(null);

  // Animation State
  const [routeState, setRouteState] = useState<'hidden' | 'animating' | 'visible'>('hidden');
  const [progress, setProgress] = useState(0); // 0 to 1

  // Marker & Share Interaction State
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
  const [selectedMarker, setSelectedMarker] = useState<any | null>(null);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [isSnapshotMode, setIsSnapshotMode] = useState(false);

  const calculateRoute = async (overrideOrigin?: string, overrideDest?: string) => {
    setIsLoading(true);
    setRouteState('hidden');
    setSelectedMarker(null);
    setHoveredMarkerId(null);
    setShowShareMenu(false);
    
    const oInput = overrideOrigin || originInput;
    const dInput = overrideDest || destInput;
    
    try {
      // 1. Geocode Origin via Nominatim
      const originRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(oInput)}&format=json&limit=1`);
      const originData = await originRes.json();
      if (!originData.length) throw new Error("Origin not found");
      const originCoords = [parseFloat(originData[0].lon), parseFloat(originData[0].lat)];

      // 2. Geocode Destination via Nominatim (1s delay to strictly respect 1 request/sec rate limit)
      await new Promise(r => setTimeout(r, 1000));
      const destRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(dInput)}&format=json&limit=1`);
      const destData = await destRes.json();
      if (!destData.length) throw new Error("Destination not found");
      const destCoords = [parseFloat(destData[0].lon), parseFloat(destData[0].lat)];

      // 3. Fetch OSRM Route
      const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}?overview=full&geometries=geojson`);
      const osrmData = await osrmRes.json();
      if (osrmData.code !== 'Ok' || !osrmData.routes.length) throw new Error("Route not found");

      const routeGeometry = osrmData.routes[0].geometry; // GeoJSON LineString
      
      let cumulativeDistances = [0];
      for (let i = 1; i < routeGeometry.coordinates.length; i++) {
        const p1 = point(routeGeometry.coordinates[i-1]);
        const p2 = point(routeGeometry.coordinates[i]);
        cumulativeDistances.push(cumulativeDistances[i-1] + distance(p1, p2, { units: 'miles' }));
      }
      const totalDistanceMi = cumulativeDistances[cumulativeDistances.length - 1];
      
      const routeFeature = { type: 'Feature', geometry: routeGeometry, properties: {} } as any;
      const totalTimeMins = Math.round(osrmData.routes[0].duration / 60);

      // 4. Create Weather Checkpoints evenly spaced along the actual road
      const segments = [];
      const numSegments = hardcodedWeatherProfiles.length;
      
      for (let i = 0; i < numSegments; i++) {
        const dist = (i / (numSegments - 1)) * totalDistanceMi;
        const pt = along(routeFeature, dist, { units: 'miles' });
        
        let locName = `Checkpoint ${i}`;
        if (i === 0) locName = oInput.split(',')[0];
        if (i === numSegments - 1) locName = dInput.split(',')[0];
        
        segments.push({
          id: `seg_${i}`,
          distanceFromStartMi: dist, // precise float distance for Turf slicing
          timeFromStartMins: Math.round((i / (numSegments - 1)) * totalTimeMins),
          locationName: locName,
          coordinates: pt.geometry.coordinates,
          weather: hardcodedWeatherProfiles[i].weather,
          alert: hardcodedWeatherProfiles[i].alert
        });
      }

      setRouteData({
        totalDistanceMi,
        totalTimeMins,
        routeLine: routeFeature,
        cumulativeDistances,
        segments
      });

      // Frame route
      if (mapRef.current) {
         const lons = routeGeometry.coordinates.map((c: any) => c[0]);
         const lats = routeGeometry.coordinates.map((c: any) => c[1]);
         mapRef.current.fitBounds(
           [
             [Math.min(...lons), Math.min(...lats)],
             [Math.max(...lons), Math.max(...lats)]
           ],
           { padding: 100, duration: 1500 }
         );
      }
      
      // Auto start animation
      setRouteState('animating');
      setProgress(0);

      // Update URL with search params for sharing
      const url = new URL(window.location.href);
      url.searchParams.set('origin', oInput);
      url.searchParams.set('dest', dInput);
      window.history.replaceState({}, '', url.toString());

    } catch (e: any) {
      console.error(e);
      alert(e.message || "Error calculating route. Please check the cities.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (routeState !== 'animating' || !routeData) return;

    let animationFrame: number;
    let startTime: number | null = null;
    
    // Dynamic duration based on route length: roughly 30ms per mile, bounded between 4s and 15s
    const ANIMATION_DURATION_MS = Math.max(4000, Math.min(15000, routeData.totalDistanceMi * 30));

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      
      // Easing function for smooth acceleration/deceleration
      const t = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      const easeInOut = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      setProgress(easeInOut);
      
      if (easeInOut >= 1) {
        setRouteState('visible');
        return;
      }

      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [routeState, routeData]);

  // Initial load effect to parse URL params or show default
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const originParam = params.get('origin');
    const destParam = params.get('dest');

    if (originParam && destParam) {
      setOriginInput(originParam);
      setDestInput(destParam);
      calculateRoute(originParam, destParam);
    } else if (!routeData && !isLoading && routeState === 'hidden') {
      calculateRoute();
    }
  }, []);

  const handleCopyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('origin', originInput);
    url.searchParams.set('dest', destInput);
    navigator.clipboard.writeText(url.toString());
    alert("Map link copied to clipboard!");
    setShowShareMenu(false);
  };

  const generateShareImage = async () => {
    if (!containerRef.current || !mapRef.current) return null;
    setShowShareMenu(false);
    setIsSnapshotMode(true);
    
    const map = mapRef.current.getMap();
    map.resize(); // Ensure map knows about any layout changes
    
    // Automatically re-frame the map to ensure the whole route is perfectly visible in the snapshot
    // Add heavy padding to the left to leave room for the info panel (which will be rendered top-left)
    if (routeData) {
      const lons = routeData.routeLine.geometry.coordinates.map((c: any) => c[0]);
      const lats = routeData.routeLine.geometry.coordinates.map((c: any) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)]
        ],
        { padding: { top: 100, bottom: 100, left: 450, right: 100 }, duration: 0 }
      );
    }
    
    // Wait for map to finish loading tiles after the bounds change
    await new Promise<void>((resolve) => {
      let resolved = false;
      const doResolve = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      if (map.isStyleLoaded() && map.areTilesLoaded()) {
        doResolve();
      } else {
        map.once('idle', doResolve);
        setTimeout(doResolve, 1500); // Fail-safe timeout
      }
    });

    // Wait for React to render snapshot UI and map to stabilize its drawing buffer
    await new Promise(r => setTimeout(r, 250)); 
    try {
      // 1. Get the map canvas data. Since preserveDrawingBuffer=true and no state props disrupt the map,
      // the canvas buffer should be intact here.
      const mapCanvas = map.getCanvas();
      const mapDataUrl = mapCanvas.toDataURL('image/png');

      // 2. Capture the UI overlay (excluding the map canvas itself)
      const uiDataUrl = await toPng(containerRef.current, { 
        cacheBust: true, 
        pixelRatio: window.devicePixelRatio || 2,
        backgroundColor: 'rgba(0,0,0,0)', // Ensure html-to-image uses transparent background
        filter: (node: HTMLElement) => {
          // Exclude the map canvas from being re-rendered by html-to-image
          if (node.tagName === 'CANVAS' && node.classList.contains('maplibregl-canvas')) {
            return false;
          }
          return true;
        }
      });

      // 3. Composite them together offscreen
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = mapCanvas.width;
      finalCanvas.height = mapCanvas.height;
      const ctx = finalCanvas.getContext('2d');
      if (!ctx) return null;

      const mapImg = new Image();
      const uiImg = new Image();
      
      const loadImage = (img: HTMLImageElement, src: string) => 
        new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = src;
        });

      await Promise.all([
        loadImage(mapImg, mapDataUrl),
        loadImage(uiImg, uiDataUrl)
      ]);

      // Draw map first (background)
      ctx.drawImage(mapImg, 0, 0);
      // Draw UI on top, scaled to fit map canvas dimensions perfectly
      ctx.drawImage(uiImg, 0, 0, finalCanvas.width, finalCanvas.height);

      return finalCanvas.toDataURL('image/png');
    } finally {
      setIsSnapshotMode(false);
    }
  };

  const handleDownloadImage = async () => {
    try {
      const dataUrl = await generateShareImage();
      if (!dataUrl) return;
      const link = document.createElement('a');
      link.download = `RouteWeather-${originInput.split(',')[0]}-to-${destInput.split(',')[0]}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error(err);
      alert("Failed to generate image.");
    }
  };

  const handleNativeShare = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('origin', originInput);
    url.searchParams.set('dest', destInput);
    
    setShowShareMenu(false);

    try {
      const shareData = {
          title: 'RouteWeather',
          text: `Check out my RouteWeather trip`,
          url: url.toString()
      };

      if (navigator.canShare && navigator.canShare(shareData)) {
          await navigator.share(shareData);
      } else {
          alert("Your device doesn't support native sharing. Please use Download Image or Copy Map Link instead.");
      }
    } catch (err: any) {
        if (err.name !== 'AbortError') {
            console.error("Error sharing", err);
        }
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full h-screen overflow-hidden text-zinc-50 font-sans flex ${isSnapshotMode ? 'bg-transparent pointer-events-none snapshot-mode' : 'bg-zinc-950'}`}>
      <style>
        {isSnapshotMode && `
          .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-top-left, .maplibregl-ctrl-top-right {
            display: none !important;
          }
        `}
      </style>
      {/* Interactive Map */}
      <div className={`absolute inset-0 z-0 ${isSnapshotMode ? 'pointer-events-none' : ''}`}>
        <Map
          ref={mapRef}
          mapLib={maplibregl}
          initialViewState={{
            longitude: -121.3,
            latitude: 38.5,
            zoom: 7.5,
            pitch: 45
          }}
          canvasContextAttributes={{ preserveDrawingBuffer: true }} // MapLibre GL JS configuration for exporting canvas
          style={{ width: '100%', height: '100%' }}
          mapStyle={rasterMapStyle as any}
        >
          {/* Glowing Route Line Segments sliced along REAL road geometry */}
          {(routeState === 'animating' || routeState === 'visible') && routeData && routeData.segments.slice(0, -1).map((seg, i) => {
            const nextSeg = routeData.segments[i + 1];
            const severity = nextSeg.weather.severity;
            
            const distToStart = seg.distanceFromStartMi;
            const distToEnd = nextSeg.distanceFromStartMi;
            const currentDist = progress * routeData.totalDistanceMi;

            let segmentGeoJsonCoords: number[][] = [];

            if (currentDist >= distToEnd) {
              // Fully drawn segment
              segmentGeoJsonCoords = getSlicedCoordinates(routeData.routeLine.geometry.coordinates, routeData.cumulativeDistances, distToStart, distToEnd);
            } else if (currentDist > distToStart) {
              // Partially drawn segment
              segmentGeoJsonCoords = getSlicedCoordinates(routeData.routeLine.geometry.coordinates, routeData.cumulativeDistances, distToStart, currentDist);
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
                    coordinates: segmentGeoJsonCoords
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

          {/* Vehicle Indicator - Hidden in Snapshot Mode */}
          {!isSnapshotMode && routeData && (routeState === 'animating' || routeState === 'visible') && (() => {
            const currentDistance = routeData.totalDistanceMi * progress;
            let currentVehiclePos: [number, number] | null = null;
            
            if (progress >= 1) {
              currentVehiclePos = routeData.segments[routeData.segments.length - 1].coordinates as [number, number];
            } else if (progress > 0) {
              for (let i = 1; i < routeData.cumulativeDistances.length; i++) {
                if (routeData.cumulativeDistances[i] >= currentDistance) {
                  const ratio = (currentDistance - routeData.cumulativeDistances[i-1]) / (routeData.cumulativeDistances[i] - routeData.cumulativeDistances[i-1]);
                  currentVehiclePos = [
                    routeData.routeLine.geometry.coordinates[i-1][0] + (routeData.routeLine.geometry.coordinates[i][0] - routeData.routeLine.geometry.coordinates[i-1][0]) * ratio,
                    routeData.routeLine.geometry.coordinates[i-1][1] + (routeData.routeLine.geometry.coordinates[i][1] - routeData.routeLine.geometry.coordinates[i-1][1]) * ratio
                  ];
                  break;
                }
              }
            } else {
              currentVehiclePos = routeData.segments[0].coordinates as [number, number];
            }
            
            if (!currentVehiclePos) return null;
            
            return (
              <Marker
                longitude={currentVehiclePos[0]}
                latitude={currentVehiclePos[1]}
              anchor="center"
              style={{ zIndex: 40 }}
            >
              <div className="relative flex items-center justify-center pointer-events-none">
                <div className="absolute w-8 h-8 bg-zinc-50 rounded-full opacity-30 animate-ping"></div>
                <div className="w-5 h-5 bg-zinc-50 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.8)] border-2 border-zinc-900">
                   <NavigationArrow size={12} weight="fill" className="text-zinc-900 rotate-45 translate-x-[1px] -translate-y-[1px]" />
                </div>
              </div>
            </Marker>
          )}

          {/* Markers for Weather Points */}
          {routeData && routeData.segments.map((seg) => {
            const isSafe = seg.weather.severity === 'safe';
            const isWarning = seg.weather.severity === 'warning';
            
            // Determine if marker should be visible
            let isVisible = false;
            if (routeState === 'visible' || isSnapshotMode) {
              isVisible = true; // Show final state
            } else if (routeState === 'animating') {
              // During animation, only show if vehicle has passed it
              const currentDist = progress * routeData.totalDistanceMi;
              isVisible = currentDist >= seg.distanceFromStartMi;
            }
            
            if (!isVisible) return null;

            const isHovered = hoveredMarkerId === seg.id;
            const isSelected = selectedMarker?.id === seg.id;

            return (
              <Marker
                key={`marker-${seg.id}`}
                longitude={seg.coordinates[0]}
                latitude={seg.coordinates[1]}
                anchor="bottom"
                style={{ zIndex: (isHovered || isSelected) && !isSnapshotMode ? 50 : 30 }}
              >
                <div className="relative">
                  {/* Tooltip (Hover State) - Hidden in Snapshot Mode */}
                  {!isSnapshotMode && isHovered && !isSelected && (
                    <div className="absolute bottom-full mb-2 -translate-x-1/2 left-1/2 flex flex-col items-center animate-in fade-in zoom-in-95 duration-150 pointer-events-none z-50">
                      <div className="bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/50 rounded-xl p-3 shadow-2xl min-w-[140px] text-center">
                        <div className="font-semibold text-sm mb-1 truncate max-w-[120px]">{seg.locationName}</div>
                        <div className="text-2xl font-bold font-mono">{seg.weather.temperatureF}°</div>
                        <div className="text-xs text-zinc-400 mt-1">{seg.weather.condition}</div>
                        {seg.weather.rainProbability > 0 && (
                          <div className="text-xs text-blue-400 mt-1 font-medium">{seg.weather.rainProbability}% Rain</div>
                        )}
                      </div>
                      <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-zinc-700/50 -mt-[1px]"></div>
                    </div>
                  )}

                  {/* Marker Pin */}
                  <div 
                    onMouseEnter={() => !isSnapshotMode && setHoveredMarkerId(seg.id)}
                    onMouseLeave={() => !isSnapshotMode && setHoveredMarkerId(null)}
                    onClick={(e) => {
                      if (isSnapshotMode) return;
                      e.stopPropagation();
                      setSelectedMarker(seg);
                    }}
                    className={`flex flex-col items-center justify-center -translate-y-2 transition-transform duration-300
                      ${isSafe ? 'text-blue-400' : isWarning ? 'text-amber-400' : 'text-fuchsia-400'}
                      ${(isHovered || isSelected) && !isSnapshotMode ? 'scale-125' : (!isSnapshotMode ? 'hover:scale-110 cursor-pointer' : '')}
                      animate-in fade-in zoom-in`}
                  >
                    <div className={`bg-zinc-900/90 backdrop-blur-md border rounded-lg p-1.5 shadow-lg flex items-center justify-center mb-1 transition-colors
                      ${isSelected && !isSnapshotMode ? 'border-current' : 'border-zinc-700/50'}`}>
                       <seg.weather.icon size={22} weight={isSelected && !isSnapshotMode ? "fill" : "duotone"} />
                    </div>
                    <div className="w-1.5 h-1.5 rounded-full bg-current shadow-[0_0_10px_currentColor]"></div>
                  </div>
                </div>
              </Marker>
            );
          })}
        </Map>
      </div>

      {/* Snapshot Overlay Graphic (Only visible in Snapshot Mode) */}
      {isSnapshotMode && routeData && (
        <div className="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between p-8 md:p-12">
          <div className="bg-zinc-900/80 backdrop-blur-3xl border border-zinc-800/80 rounded-[2rem] p-8 max-w-[26rem] shadow-2xl self-start mt-4 ml-4">
            <h1 className="text-[2.5rem] leading-tight font-bold tracking-tight text-white mb-6">
              {originInput.split(',')[0]}<br/>
              <span className="text-zinc-500 font-medium tracking-normal text-3xl">to </span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 to-purple-500 text-4xl">{destInput.split(',')[0]}</span>
            </h1>
            
            <div className="flex items-center gap-8 mt-2 pt-6 border-t border-zinc-800/80">
               <div>
                 <div className="text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-widest">Est. Travel Time</div>
                 <div className="text-2xl font-bold text-white tracking-tight">{Math.floor(routeData.totalTimeMins / 60)}h {routeData.totalTimeMins % 60}m</div>
               </div>
               <div className="w-px h-10 bg-zinc-800"></div>
               <div>
                 <div className="text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-widest">Distance</div>
                 <div className="text-2xl font-bold text-white tracking-tight">{Math.round(routeData.totalDistanceMi)} mi</div>
               </div>
            </div>
          </div>
          
          <div className="self-end bg-zinc-950/80 backdrop-blur-md border border-zinc-800/50 rounded-full px-5 py-2 flex items-center gap-2 shadow-xl">
             <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.8)]"></div>
             <span className="font-bold tracking-tight text-white">RouteWeather</span>
          </div>
        </div>
      )}

      {/* Sidebar Dashboard (Hidden in Snapshot Mode) */}
      {!isSnapshotMode && (
        <div className="absolute top-0 left-0 w-full md:w-[400px] h-full flex flex-col p-4 md:p-6 z-10 pointer-events-none">
          
          {/* Input Panel */}
          <div className="pointer-events-auto bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-2xl p-5 mb-4 shadow-2xl flex-shrink-0 relative">
            
            {/* Share Button & Dropdown */}
            <div className="absolute top-4 right-4 z-20">
              <button 
                onClick={() => setShowShareMenu(!showShareMenu)}
                className={`p-2 rounded-xl transition-colors ${showShareMenu ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'}`}
                title="Share Route"
              >
                <ShareNetwork size={20} />
              </button>
              
              {showShareMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                  <button onClick={handleDownloadImage} className="w-full text-left px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 flex items-center gap-3 transition-colors">
                    <ImageIcon size={18} />
                    Share Image
                  </button>
                  <div className="h-px bg-zinc-800/50 mx-2"></div>
                  <button onClick={handleCopyLink} className="w-full text-left px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 flex items-center gap-3 transition-colors">
                    <Link size={18} />
                    Copy Map Link
                  </button>
                  <div className="h-px bg-zinc-800/50 mx-2"></div>
                  <button onClick={handleNativeShare} className="w-full text-left px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 flex items-center gap-3 transition-colors">
                    <Export size={18} />
                    Share
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 mt-1">
              <div className="flex items-center gap-3 bg-zinc-800/50 rounded-xl px-4 py-3 border border-transparent focus-within:border-zinc-700 transition-colors mr-10">
                <MapPin size={20} className="text-zinc-400" />
                <input 
                  type="text" 
                  value={originInput}
                  onChange={e => setOriginInput(e.target.value)}
                  className="bg-transparent border-none outline-none text-sm w-full font-medium" 
                  placeholder="Starting location..."
                />
              </div>
              <div className="w-[1px] h-3 bg-zinc-700 ml-6"></div>
              <div className="flex items-center gap-3 bg-zinc-800/50 rounded-xl px-4 py-3 border border-transparent focus-within:border-zinc-700 transition-colors">
                <Flag size={20} className="text-zinc-400" />
                <input 
                  type="text" 
                  value={destInput}
                  onChange={e => setDestInput(e.target.value)}
                  className="bg-transparent border-none outline-none text-sm w-full font-medium" 
                  placeholder="Destination..."
                />
              </div>
            </div>
            
            <div className="mt-5 pt-4 border-t border-zinc-800 flex justify-between items-end">
              <div>
                <div className="text-3xl font-bold tracking-tight">
                  {routeData ? `${Math.floor(routeData.totalTimeMins / 60)}h ${routeData.totalTimeMins % 60}m` : '--h --m'}
                </div>
                <div className="text-sm text-zinc-400 font-mono mt-1">
                  {routeData ? `${Math.round(routeData.totalDistanceMi)} mi` : '-- mi'}
                </div>
              </div>
              <button 
                onClick={() => calculateRoute()}
                disabled={isLoading || routeState === 'animating'}
                className="bg-zinc-100 text-zinc-900 font-medium px-4 py-2 rounded-full text-sm hover:bg-white transition-colors active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <SpinnerGap size={16} className="animate-spin" />
                    Routing...
                  </>
                ) : routeState === 'animating' ? 'Navigating...' : 'Leave Now'}
              </button>
            </div>
          </div>

          {/* Timeline (Scrollable) */}
          {routeData && (
            <div className="pointer-events-auto flex-1 overflow-y-auto no-scrollbar bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-2xl p-5 shadow-2xl relative">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500 mb-6 px-2 sticky top-0 bg-zinc-900/90 backdrop-blur py-2 z-10 -mt-2">Weather Route</h2>
              
              <div className="relative pl-6 pb-4">
                {/* Connecting line */}
                <div className="absolute top-4 bottom-4 left-[11px] w-[2px] bg-zinc-800 rounded-full"></div>
                
                <div className="flex flex-col gap-8">
                  {routeData.segments.map((seg) => {
                    const Icon = seg.weather.icon;
                    const isSafe = seg.weather.severity === 'safe';
                    const isWarning = seg.weather.severity === 'warning';
                    
                    // Dim timeline items if they haven't been reached yet during animation
                    const currentDist = progress * routeData.totalDistanceMi;
                    const isReached = routeState === 'visible' || currentDist >= seg.distanceFromStartMi;

                    return (
                      <div key={seg.id} className={`relative transition-opacity duration-500 ${isReached ? 'opacity-100' : 'opacity-30'}`}>
                        {/* Node */}
                        <div className={`absolute -left-6 w-3 h-3 rounded-full border-2 border-zinc-900 mt-1.5 z-10 
                          ${isSafe ? 'bg-blue-500' : isWarning ? 'bg-amber-500' : 'bg-fuchsia-500'}`}>
                        </div>

                        <div className="flex flex-col gap-1">
                          <div className="flex justify-between items-baseline">
                            <h3 className="font-medium text-zinc-100 truncate pr-2 max-w-[150px]">{seg.locationName}</h3>
                            <span className="text-xs font-mono text-zinc-500 flex-shrink-0">+{seg.timeFromStartMins}m</span>
                          </div>
                          
                          <div className="flex items-center gap-4 mt-2">
                            <div className="flex items-center gap-2">
                              <Icon size={24} className={isSafe ? 'text-blue-400' : isWarning ? 'text-amber-400' : 'text-fuchsia-400'} weight="duotone" />
                              <span className="font-mono text-lg">{seg.weather.temperatureF}°</span>
                            </div>
                            <span className="text-sm text-zinc-400">{seg.weather.condition}</span>
                          </div>

                          {seg.alert && (
                            <div className={`mt-3 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium self-start
                              ${isWarning ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 
                              'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20'}`}>
                              {seg.alert}
                            </div>
                          )}

                          {/* Interactive button to show details */}
                          <button 
                            onClick={() => setSelectedMarker(seg)}
                            className="mt-3 text-xs font-medium text-zinc-400 hover:text-zinc-200 self-start transition-colors px-2 py-1 -ml-2 rounded-md hover:bg-zinc-800/50"
                          >
                            More info
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detailed Weather Modal (Hidden in Snapshot Mode) */}
      {!isSnapshotMode && selectedMarker && (
        <div 
          className="absolute inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-black/40 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200"
          onClick={() => setSelectedMarker(null)}
        >
          <div 
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-start p-6 pb-4 bg-zinc-900 z-10 sticky top-0 border-b border-zinc-800/50">
              <div>
                <h2 className="text-xl font-bold text-zinc-100">{selectedMarker.locationName}</h2>
                <p className="text-sm text-zinc-400 mt-1">Arrival: {selectedMarker.timeFromStartMins} mins from start</p>
              </div>
              <button 
                onClick={() => setSelectedMarker(null)}
                className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 pb-6 pt-4 space-y-6 overflow-y-auto no-scrollbar flex-1">
              
              {/* Main Temp & Condition */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-2xl ${
                    selectedMarker.weather.severity === 'safe' ? 'bg-blue-500/10 text-blue-400' : 
                    selectedMarker.weather.severity === 'warning' ? 'bg-amber-500/10 text-amber-400' : 'bg-fuchsia-500/10 text-fuchsia-400'
                  }`}>
                    <selectedMarker.weather.icon size={48} weight="duotone" />
                  </div>
                  <div>
                    <div className="text-5xl font-bold font-mono tracking-tight">{selectedMarker.weather.temperatureF}°</div>
                    <div className="text-lg text-zinc-300 font-medium">{selectedMarker.weather.condition}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-zinc-400 mb-1">Feels Like</div>
                  <div className="text-2xl font-mono text-zinc-200">{selectedMarker.weather.feelsLikeF}°</div>
                </div>
              </div>

              {/* Grid Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-800/50 rounded-xl p-3 flex items-center gap-3 border border-zinc-800/80">
                  <Wind size={20} className="text-zinc-400" />
                  <div>
                    <div className="text-xs text-zinc-500">Wind</div>
                    <div className="text-sm font-medium">{selectedMarker.weather.windSpeedMph} mph {selectedMarker.weather.windDirection}</div>
                  </div>
                </div>
                <div className="bg-zinc-800/50 rounded-xl p-3 flex items-center gap-3 border border-zinc-800/80">
                  <Drop size={20} className="text-blue-400" />
                  <div>
                    <div className="text-xs text-zinc-500">Precipitation</div>
                    <div className="text-sm font-medium">{selectedMarker.weather.precipitationIn}" / {selectedMarker.weather.rainProbability}%</div>
                  </div>
                </div>
                <div className="bg-zinc-800/50 rounded-xl p-3 flex items-center gap-3 border border-zinc-800/80">
                  <Eye size={20} className="text-zinc-400" />
                  <div>
                    <div className="text-xs text-zinc-500">Visibility</div>
                    <div className="text-sm font-medium">{selectedMarker.weather.visibilityMi} mi</div>
                  </div>
                </div>
                <div className="bg-zinc-800/50 rounded-xl p-3 flex items-center gap-3 border border-zinc-800/80">
                  <CloudCheck size={20} className="text-zinc-400" />
                  <div>
                    <div className="text-xs text-zinc-500">Cloud Cover</div>
                    <div className="text-sm font-medium">{selectedMarker.weather.cloudCover}%</div>
                  </div>
                </div>
              </div>

              {/* Alerts & Risk */}
              <div className="space-y-3">
                {selectedMarker.alert && (
                  <div className={`p-4 rounded-xl border flex items-start gap-3 ${
                    selectedMarker.weather.severity === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 
                    'bg-fuchsia-500/10 border-fuchsia-500/20 text-fuchsia-400'
                  }`}>
                    <Warning size={20} weight="fill" className="mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-sm mb-0.5">Active Alert</div>
                      <div className="text-sm opacity-90">{selectedMarker.alert}</div>
                    </div>
                  </div>
                )}
                
                <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-800/50">
                  <div className="font-medium text-sm text-zinc-300 mb-2">Road Risk Assessment</div>
                  <div className="text-sm text-zinc-400 leading-relaxed">{selectedMarker.weather.riskAssessment}</div>
                </div>

                <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-800/50">
                  <div className="font-medium text-sm text-zinc-300 mb-2">Forecast</div>
                  <div className="text-sm text-zinc-400 leading-relaxed">{selectedMarker.weather.forecastText}</div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default App
