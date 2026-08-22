import { useState, useRef, useEffect, useMemo } from 'react';
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
  ShareNetwork,
  Image as ImageIcon,
  Link,
  Export
} from '@phosphor-icons/react'
import * as maplibregl from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';

import bearing from '@turf/bearing';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { toPng } from 'html-to-image';

// Fix for Vite production build: explicitly set the worker URL so it resolves correctly
maplibregl.setWorkerUrl(mapLibreWorkerUrl);

import 'maplibre-gl/dist/maplibre-gl.css';

const IconMap: Record<string, any> = {
  "Sun": Sun,
  "Cloud": Cloud,
  "CloudRain": CloudRain,
  "CloudLightning": CloudLightning,
  "Snowflake": Snowflake,
  "CloudSnow": CloudSnow
};

const getRasterMapStyle = () => ({
  version: 8,
  sources: {
    'carto-basemap': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: '&copy; Esri'
    }
  },
  layers: [
    {
      id: 'carto-basemap-layer',
      type: 'raster',
      source: 'carto-basemap',
      minzoom: 0,
      maxzoom: 22
    }
  ]
});

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
  const accumulatedBearingRef = useRef(0);
  
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

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const calculateRoute = async (overrideOrigin?: string, overrideDest?: string) => {
    // Debounce to prevent rapid repeated calls
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    return new Promise<void>((resolve) => {
      debounceTimeoutRef.current = setTimeout(async () => {
        setIsLoading(true);
        setRouteState('hidden');
        setSelectedMarker(null);
        setHoveredMarkerId(null);
        setShowShareMenu(false);
        
        const oInput = overrideOrigin || originInput;
        const dInput = overrideDest || destInput;
        
        if (!oInput || !dInput) {
          setIsLoading(false);
          resolve();
          return;
        }

        try {
          const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';
          // Unified backend workflow call
          const response = await fetch(`${API_BASE}/api/route-weather`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              origin: oInput,
              destination: dInput
            })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Failed to fetch route and weather");
          }

          const resData = await response.json();
          const { geometry, durationSeconds, checkpoints } = resData.data;

          // Recreate cumulative distances on frontend for animation purposes
          let cumulativeDistances = [0];
          for (let i = 1; i < geometry.coordinates.length; i++) {
            const p1 = point(geometry.coordinates[i-1]);
            const p2 = point(geometry.coordinates[i]);
            cumulativeDistances.push(cumulativeDistances[i-1] + distance(p1, p2, { units: 'miles' }));
          }
          const totalDistanceMi = cumulativeDistances[cumulativeDistances.length - 1];
          const totalTimeMins = Math.round(durationSeconds / 60);
          
          const routeFeature = { type: 'Feature', geometry, properties: {} } as any;

          setRouteData({
            totalDistanceMi,
            totalTimeMins,
            routeLine: routeFeature,
            cumulativeDistances,
            segments: checkpoints
          });

          // Frame route
          if (mapRef.current) {
             const lons = geometry.coordinates.map((c: any) => c[0]);
             const lats = geometry.coordinates.map((c: any) => c[1]);
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
          resolve();
        }
      }, 300); // 300ms debounce
    });
  };

  useEffect(() => {
    if (routeState !== 'animating' || !routeData) return;

    let animationFrame: number;
    let startTime: number | null = null;
    
    const ANIMATION_DURATION_MS = 300; // subtle, quick transition

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      
      // ease-out cubic for a fast but smooth deceleration
      const t = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      const easeOut = 1 - Math.pow(1 - t, 3);

      setProgress(easeOut);
      
      if (easeOut >= 1) {
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

  const currentMapStyle = useMemo(() => getRasterMapStyle(), []);

  return (
    <div ref={containerRef} className={`relative w-full h-screen overflow-hidden text-text-primary font-sans flex ${isSnapshotMode ? 'bg-transparent pointer-events-none snapshot-mode' : 'bg-bg-base'}`}>
      <style>
        {isSnapshotMode && `
          .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-top-left, .maplibregl-ctrl-top-right {
            display: none !important;
          }
        `}
      </style>

      {/* Floating Map Title */}
      {!isSnapshotMode && routeData && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 md:left-[calc(50%+200px)] pointer-events-none z-20 animate-in fade-in slide-in-from-top-4">
          <div className="dash-glass px-6 py-2.5 rounded-full shadow-2xl flex items-center gap-2">
            <h1 className="text-dash-label !text-xs !tracking-widest !m-0">Weather Along Route</h1>
          </div>
        </div>
      )}

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
          mapStyle={currentMapStyle as any}
        >
          {/* Glowing Route Line Segments sliced along REAL road geometry */}
          {(routeState === 'animating' || routeState === 'visible') && routeData && routeData.segments.slice(0, -1).map((seg, i) => {
            const nextSeg = routeData.segments[i + 1];
            
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

            const glowColor = 'rgba(0, 0, 0, 0.4)'; // Subtle shadow/glow for contrast against satellite
            const coreColor = '#ffffff';

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
                    'line-opacity': 0.6,
                    'line-blur': 3
                  }}
                />
                <Layer
                  id={`route-line-core-${seg.id}`}
                  type="line"
                  paint={{
                    'line-color': coreColor,
                    'line-width': 2,
                    'line-dasharray': [1, 2]
                  }}
                />
              </Source>
            );
          })}

          {/* Vehicle Indicator - Hidden in Snapshot Mode */}
          {!isSnapshotMode && routeData && (routeState === 'animating' || routeState === 'visible') && (() => {
            const currentDistance = routeData.totalDistanceMi * progress;
            let currentVehiclePos: [number, number] | null = null;
            let currentBearing = 0;
            const coords = routeData.routeLine.geometry.coordinates;
            
            if (progress >= 1) {
              currentVehiclePos = routeData.segments[routeData.segments.length - 1].coordinates as [number, number];
              if (coords.length >= 2) {
                currentBearing = bearing(point(coords[coords.length - 2]), point(coords[coords.length - 1]));
              }
            } else if (progress > 0) {
              for (let i = 1; i < routeData.cumulativeDistances.length; i++) {
                if (routeData.cumulativeDistances[i] >= currentDistance) {
                  const p1 = coords[i-1];
                  const p2 = coords[i];
                  const ratio = (currentDistance - routeData.cumulativeDistances[i-1]) / (routeData.cumulativeDistances[i] - routeData.cumulativeDistances[i-1]);
                  currentVehiclePos = [
                    p1[0] + (p2[0] - p1[0]) * ratio,
                    p1[1] + (p2[1] - p1[1]) * ratio
                  ];
                  currentBearing = bearing(point(p1), point(p2));
                  break;
                }
              }
            } else {
              currentVehiclePos = routeData.segments[0].coordinates as [number, number];
              if (coords.length >= 2) {
                currentBearing = bearing(point(coords[0]), point(coords[1]));
              }
            }
            
            if (!currentVehiclePos) return null;
            
            // Normalize bearing to prevent 180-degree flips and accumulate
            let prevAccum = accumulatedBearingRef.current;
            let diff = currentBearing - (prevAccum % 360);
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            accumulatedBearingRef.current = prevAccum + diff;
            
            return (
              <Marker
                longitude={currentVehiclePos[0]}
                latitude={currentVehiclePos[1]}
              anchor="center"
              style={{ zIndex: 40 }}
            >
              <div className="relative flex items-center justify-center pointer-events-none">
                <div className="absolute w-8 h-8 bg-white border border-white rounded-full opacity-30 animate-ping"></div>
                <div 
                  className="w-5 h-5 bg-white border-2 border-zinc-900 rounded-full flex items-center justify-center shadow-[0_0_8px_rgba(0,0,0,0.6)] transition-transform duration-100 ease-linear"
                  style={{ transform: `rotate(${accumulatedBearingRef.current}deg)` }}
                >
                   <NavigationArrow size={12} weight="fill" className="text-zinc-900 -rotate-45" />
                </div>
              </div>
            </Marker>
            );
          })()}

          {/* Markers for Weather Points */}
          {routeData && routeData.segments.map((seg) => {
            
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
                  {/* Contextual Tooltip */}
                  {!isSnapshotMode && (isHovered || isSelected) && (
                    <div className="absolute bottom-full mb-3 -translate-x-1/2 left-1/2 flex flex-col items-center animate-in fade-in zoom-in-95 duration-150 pointer-events-none z-50">
                      <div className="dash-glass px-4 py-2 shadow-2xl text-center rounded-xl whitespace-nowrap">
                        <div className="text-[10px] uppercase tracking-widest font-semibold mb-0.5 text-[var(--color-dash-text-muted)] truncate max-w-[150px]">{seg.locationName}</div>
                        <div className="text-2xl font-light font-mono text-[var(--color-dash-text)]">{seg.weather.temperatureF}°</div>
                      </div>
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
                    className={`flex items-center justify-center transition-transform duration-300
                      ${(isHovered || isSelected) && !isSnapshotMode ? 'scale-125' : (!isSnapshotMode ? 'hover:scale-110 cursor-pointer' : '')}
                      animate-in fade-in zoom-in`}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full bg-white border-2 border-[var(--color-dash-bg)] shadow-[0_0_8px_rgba(0,0,0,0.6)] flex items-center justify-center transition-colors animate-gentle-pulse
                      ${isSelected && !isSnapshotMode ? 'bg-zinc-200' : ''}`}>
                    </div>
                  </div>
                </div>
              </Marker>
            );
          })}
        </Map>
      </div>

      {/* Right Side Overlays (Summary & Zoom) */}
      {!isSnapshotMode && (
        <div className="absolute bottom-8 right-8 z-20 flex items-end gap-4 pointer-events-none">
          
          {/* Conditions Summary Card */}
          {routeData && (
            <div className="pointer-events-auto dash-glass p-5 shadow-2xl flex flex-col w-[320px] animate-in fade-in slide-in-from-bottom-4">
              <h2 className="text-dash-label mb-1">Overall Trip Risk</h2>
              <div className="flex items-baseline gap-1 mt-1 mb-4">
                <span className="text-dash-hero">
                  {(() => {
                    const total = routeData.segments.length;
                    if (total === 0) return 0;
                    const critical = routeData.segments.filter(s => s.weather.severity === 'critical').length;
                    const warning = routeData.segments.filter(s => s.weather.severity === 'warning').length;
                    // Calculate a risk score from 0-100 where 100 is completely safe
                    return Math.round(((total - critical - (warning * 0.5)) / total) * 100);
                  })()}
                </span>
                <span className="text-dash-body text-[var(--color-dash-text-muted)]">/ 100</span>
              </div>
              
              {/* Compact Table */}
              <div className="relative border-t border-[var(--color-dash-border)] pt-3">
                <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto no-scrollbar pb-6 [mask-image:linear-gradient(to_bottom,white_80%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,white_80%,transparent_100%)]">
                  {routeData.segments.map((seg) => {
                    const isSafe = seg.weather.severity === 'safe';
                    const isWarning = seg.weather.severity === 'warning';
                    return (
                      <div key={seg.id} className="flex items-center justify-between py-1.5 border-b border-[var(--color-dash-border)]/50 last:border-0 hover:bg-[var(--color-dash-surface-hover)] -mx-2 px-2 rounded-lg transition-colors cursor-pointer" onClick={() => setSelectedMarker(seg)}>
                        <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--color-dash-text-muted)] truncate max-w-[130px]">{seg.locationName}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-dash-body font-mono text-[var(--color-dash-text)]">{seg.weather.temperatureF}°</span>
                          <div className={`flex items-center gap-1 text-[11px] font-bold font-mono w-12 justify-end ${
                            isSafe ? 'text-[var(--weather-safe)]' : 
                            isWarning ? 'text-[var(--weather-warning)]' : 
                            'text-[var(--weather-critical)]'
                          }`}>
                             <span>{isSafe ? '▲' : '▼'}</span>
                             <span>{isSafe ? 'OK' : isWarning ? 'WRN' : 'RSK'}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Minimal Zoom Controls */}
          <div className="pointer-events-auto flex flex-col bg-[var(--color-dash-border)] p-[1px] rounded-full overflow-hidden shadow-2xl backdrop-blur-xl shrink-0">
            <button 
              onClick={() => mapRef.current?.zoomIn()}
              className="w-10 h-10 bg-[var(--color-dash-surface)] hover:bg-[var(--color-dash-surface-hover)] flex items-center justify-center transition-colors rounded-t-full text-[var(--color-dash-text)] text-lg font-light"
            >
              +
            </button>
            <div className="h-[1px] w-full bg-[var(--color-dash-border)]"></div>
            <button 
              onClick={() => mapRef.current?.zoomOut()}
              className="w-10 h-10 bg-[var(--color-dash-surface)] hover:bg-[var(--color-dash-surface-hover)] flex items-center justify-center transition-colors rounded-b-full text-[var(--color-dash-text)] text-lg font-light"
            >
              -
            </button>
          </div>
        </div>
      )}

      {/* Snapshot Overlay Graphic (Only visible in Snapshot Mode) */}
      {isSnapshotMode && routeData && (
        <div className="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between p-8 md:p-12">
          <div className="bg-bg-surface backdrop-blur-3xl border border-border-subtle rounded-[2rem] p-8 max-w-[26rem] shadow-2xl self-start mt-4 ml-4">
            <h1 className="text-[2.5rem] leading-tight font-bold tracking-tight text-white mb-6">
              {originInput.split(',')[0]}<br/>
              <span className="text-text-primary0 font-medium tracking-normal text-3xl">to </span>
              <span className="text-white text-4xl">{destInput.split(',')[0]}</span>
            </h1>
            
            <div className="flex items-center gap-8 mt-2 pt-6 border-t border-border-subtle">
               <div>
                 <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-widest">Est. Travel Time</div>
                 <div className="text-2xl font-bold text-white tracking-tight">{Math.floor(routeData.totalTimeMins / 60)}h {routeData.totalTimeMins % 60}m</div>
               </div>
               <div className="w-px h-10 bg-bg-elevated"></div>
               <div>
                 <div className="text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-widest">Distance</div>
                 <div className="text-2xl font-bold text-white tracking-tight">{Math.round(routeData.totalDistanceMi)} mi</div>
               </div>
            </div>
          </div>
          
          <div className="self-end bg-bg-surface backdrop-blur-md border border-border-subtle rounded-full px-5 py-2 flex items-center gap-2 shadow-xl">
             <div className="w-3 h-3 rounded-full bg-weather-safe animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.8)]"></div>
             <span className="font-bold tracking-tight text-white">RouteWeather</span>
          </div>
        </div>
      )}



      {/* Sidebar Dashboard (Hidden in Snapshot Mode) */}
      {!isSnapshotMode && (
        <div className="absolute top-0 left-0 w-full md:w-[400px] h-full flex flex-col gap-4 p-4 md:p-6 z-10 pointer-events-none">
          
          {/* Top Navigation Pill */}
          <div className="pointer-events-auto flex items-center p-1.5 bg-[var(--color-dash-surface)] backdrop-blur-xl border border-[var(--color-dash-border)] rounded-full self-start shadow-2xl flex-shrink-0">
            <div className="pl-3 pr-4 flex items-center justify-center text-[var(--color-dash-text)]">
               <NavigationArrow size={20} weight="bold" className="-rotate-45" />
            </div>
            <div className="flex items-center gap-1">
              <button className="px-5 py-2 bg-[var(--color-dash-text)] text-[var(--color-dash-bg)] rounded-full text-[13px] font-medium transition-colors">
                Route Planner
              </button>
              <button className="px-5 py-2 text-[var(--color-dash-text-muted)] hover:text-[var(--color-dash-text)] rounded-full text-[13px] font-medium transition-colors">
                Fleet
              </button>
              <button className="px-5 py-2 text-[var(--color-dash-text-muted)] hover:text-[var(--color-dash-text)] rounded-full text-[13px] font-medium transition-colors">
                History
              </button>
            </div>
          </div>

          {/* Input Panel Card */}
          <div className="pointer-events-auto dash-glass p-5 shadow-2xl flex-shrink-0 relative animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out fill-mode-both" style={{ animationDelay: '50ms' }}>
            
            {/* Share Dropdown */}
            <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
              <div className="relative">
                <button 
                  onClick={() => setShowShareMenu(!showShareMenu)}
                  className={`p-2 rounded-lg transition-colors ${showShareMenu ? 'bg-bg-elevated text-text-primary' : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated hover:bg-bg-overlay'}`}
                  title="Share Route"
                >
                  <ShareNetwork size={20} />
                </button>
                
                {showShareMenu && (
                  <div className="absolute right-0 mt-2 w-48 bg-bg-surface border border-border-subtle rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                  <button onClick={handleDownloadImage} className="w-full text-left px-4 py-3 text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary flex items-center gap-3 transition-colors">
                    <ImageIcon size={18} />
                    Share Image
                  </button>
                  <div className="h-px bg-bg-elevated hover:bg-bg-overlay mx-2"></div>
                  <button onClick={handleCopyLink} className="w-full text-left px-4 py-3 text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary flex items-center gap-3 transition-colors">
                    <Link size={18} />
                    Copy Map Link
                  </button>
                  <div className="h-px bg-bg-elevated hover:bg-bg-overlay mx-2"></div>
                  <button onClick={handleNativeShare} className="w-full text-left px-4 py-3 text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary flex items-center gap-3 transition-colors">
                    <Export size={18} />
                    Share
                  </button>
                </div>
              )}
            </div>
          </div>
            <div className="flex flex-col gap-3 mt-1 pr-10">
              <div className="flex items-center gap-3 bg-[var(--color-dash-surface-hover)] rounded-lg px-4 py-3 border border-transparent focus-within:border-[var(--color-dash-border)] transition-colors">
                <MapPin size={20} className="text-[var(--color-dash-text-muted)]" />
                <input 
                  type="text" 
                  value={originInput}
                  onChange={e => setOriginInput(e.target.value)}
                  className="bg-transparent border-none outline-none text-dash-body w-full text-[var(--color-dash-text)]" 
                  placeholder="Starting location..."
                />
              </div>
              <div className="w-[1px] h-3 bg-[var(--color-dash-border)] ml-6"></div>
              <div className="flex items-center gap-3 bg-[var(--color-dash-surface-hover)] rounded-lg px-4 py-3 border border-transparent focus-within:border-[var(--color-dash-border)] transition-colors">
                <Flag size={20} className="text-[var(--color-dash-text-muted)]" />
                <input 
                  type="text" 
                  value={destInput}
                  onChange={e => setDestInput(e.target.value)}
                  className="bg-transparent border-none outline-none text-dash-body w-full text-[var(--color-dash-text)]" 
                  placeholder="Destination..."
                />
              </div>
            </div>
            
            <div className="mt-5 pt-4 border-t border-[var(--color-dash-border)] flex justify-end">
              <button 
                onClick={() => calculateRoute()}
                disabled={isLoading || routeState === 'animating'}
                className="bg-[var(--color-dash-text)] text-[var(--color-dash-bg)] font-medium px-4 py-2 rounded-full text-[13px] hover:opacity-90 transition-opacity active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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

          {routeData && (
            <>
              {/* Slim Status Row */}
              <div className="pointer-events-auto dash-glass px-5 py-3 flex items-center justify-between shadow-2xl flex-shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out fill-mode-both" style={{ animationDelay: '100ms' }}>
                <div className="flex items-center gap-2 text-dash-body">
                  <div className="w-2 h-2 rounded-full bg-[var(--weather-safe)]"></div>
                  <span>Safe Stops: {routeData.segments.filter(s => s.weather.severity === 'safe').length}</span>
                </div>
                <div className="flex items-center gap-2 text-dash-body">
                  <div className="w-2 h-2 rounded-full bg-[var(--weather-critical)]"></div>
                  <span>Warning/Critical: {routeData.segments.filter(s => s.weather.severity !== 'safe').length}</span>
                </div>
              </div>

              {/* Hero Metric Card */}
              <div className="pointer-events-auto dash-glass p-5 flex flex-col shadow-2xl flex-shrink-0 relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out fill-mode-both" style={{ animationDelay: '150ms' }}>
                <h2 className="text-dash-label mb-1">Route Distance & Time</h2>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-dash-hero">{Math.round(routeData.totalDistanceMi)}</span>
                  <span className="text-dash-body text-[var(--color-dash-text-muted)]">mi</span>
                </div>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-dash-hero">{Math.floor(routeData.totalTimeMins / 60)}h {routeData.totalTimeMins % 60}m</span>
                </div>
                {/* Visual Sparkline */}
                <svg className="absolute bottom-0 right-0 w-32 h-16 opacity-20 pointer-events-none animate-draw" viewBox="0 0 100 50" preserveAspectRatio="none">
                  <path d="M0,50 L10,35 L30,40 L50,20 L70,30 L90,10 L100,5" fill="none" stroke="var(--color-dash-text)" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
                </svg>
              </div>

              {/* Scrollable Checkpoint List (Replaces Timeline) */}
              <div className="pointer-events-auto flex flex-col gap-3 flex-1 overflow-y-auto no-scrollbar pb-10 min-h-0 animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out fill-mode-both [mask-image:linear-gradient(to_bottom,white_85%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,white_85%,transparent_100%)]" style={{ animationDelay: '200ms' }}>
                {routeData.segments.map((seg) => {
                  const Icon = IconMap[seg.weather.icon] || Sun;
                  const isSafe = seg.weather.severity === 'safe';
                  const isWarning = seg.weather.severity === 'warning';
                  
                  const currentDist = progress * routeData.totalDistanceMi;
                  const isReached = routeState === 'visible' || currentDist >= seg.distanceFromStartMi;
                  // Calculate progress for this segment (starts when passed previous segment, finishes when passing this one)
                  const progressPercent = Math.min(100, Math.max(0, (currentDist / seg.distanceFromStartMi) * 100));
                  
                  return (
                    <div 
                      key={seg.id} 
                      onClick={() => setSelectedMarker(seg)}
                      className={`dash-glass p-4 transition-all duration-500 cursor-pointer hover:bg-[var(--color-dash-surface-hover)] ${isReached ? 'opacity-100' : 'opacity-40'}`}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-1.5 rounded-lg ${isSafe ? 'text-[var(--weather-safe)] bg-[var(--weather-safe-bg)]' : isWarning ? 'text-[var(--weather-warning)] bg-[var(--weather-warning-bg)]' : 'text-[var(--weather-critical)] bg-[var(--weather-critical-bg)]'}`}>
                            <Icon size={16} weight="duotone" />
                          </div>
                          <div>
                            <h3 className="text-dash-body font-medium truncate max-w-[120px]">{seg.locationName}</h3>
                            <div className="text-dash-label mt-0.5">+{seg.timeFromStartMins}m</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-dash-hero !text-xl !leading-none">{seg.weather.temperatureF}°</div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 mb-3">
                        {seg.alert && (
                          <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${isWarning ? 'bg-[var(--weather-warning-bg)] text-[var(--weather-warning)]' : 'bg-[var(--weather-critical-bg)] text-[var(--weather-critical)]'}`}>
                            {seg.alert.split(' ')[0]}
                          </span>
                        )}
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white/10 text-white/70">
                          {seg.weather.condition}
                        </span>
                      </div>

                      {/* Thin Progress Bar */}
                      <div className="w-full h-[2px] bg-white/10 rounded-full overflow-hidden relative">
                        <div 
                          className="absolute top-0 left-0 h-full bg-white/50 transition-all duration-300" 
                          style={{ width: `${progressPercent}%` }}
                        ></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

    </div>
  )
}

export default App
