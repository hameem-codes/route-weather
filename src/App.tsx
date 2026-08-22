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
  SpinnerGap,
  ShareNetwork,
  Image as ImageIcon,
  Link,
  Export,
  Trash,
  Clock,
  Thermometer,
  Drop,
  Wind,
  Eye,
  Warning,
  X,
  CaretLeft,
  CaretRight,
  Truck,
  ClockCounterClockwise as HistoryIcon,
  Brain,
  Info
} from '@phosphor-icons/react';
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

const getHybridMapStyle = () => ({
  version: 8,
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: '&copy; Esri, Maxar'
    },
    'esri-roads': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256
    },
    'esri-labels': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256
    }
  },
  layers: [
    {
      id: 'satellite-layer',
      type: 'raster',
      source: 'esri-satellite',
      minzoom: 0,
      maxzoom: 22
    },
    {
      id: 'roads-layer',
      type: 'raster',
      source: 'esri-roads',
      minzoom: 0,
      maxzoom: 22,
      paint: {
        'raster-opacity': 0.8
      }
    },
    {
      id: 'labels-layer',
      type: 'raster',
      source: 'esri-labels',
      minzoom: 0,
      maxzoom: 22
    }
  ]
});

const IconMap: Record<string, any> = {
  "Sun": Sun,
  "Cloud": Cloud,
  "CloudRain": CloudRain,
  "CloudLightning": CloudLightning,
  "Snowflake": Snowflake,
  "CloudSnow": CloudSnow
};

// Centralized Unit Formatter Configuration
const UNIT_CONFIG = {
  tempSymbol: '°C',
  formatTemp: (val?: number) => val !== undefined ? `${val}°C` : '--°C',
  formatWind: (val?: number) => val !== undefined ? `${val} mph` : '-- mph',
  formatDistance: (val?: number) => val !== undefined ? `${Math.round(val)} mi` : '-- mi',
};

// Calculate coordinates and bearing at a specific distance along a route
const getPointAtDistance = (coords: number[][], cumulativeDists: number[], targetDist: number) => {
  if (coords.length === 0) return { pos: [0, 0] as [number, number], bearing: 0 };
  if (targetDist <= 0) {
    const b = coords.length >= 2 ? bearing(point(coords[0]), point(coords[1])) : 0;
    return { pos: coords[0] as [number, number], bearing: b };
  }
  const totalDist = cumulativeDists[cumulativeDists.length - 1];
  if (targetDist >= totalDist) {
    const b = coords.length >= 2 ? bearing(point(coords[coords.length - 2]), point(coords[coords.length - 1])) : 0;
    return { pos: coords[coords.length - 1] as [number, number], bearing: b };
  }
  
  for (let i = 1; i < cumulativeDists.length; i++) {
    if (cumulativeDists[i] >= targetDist) {
      const p1 = coords[i-1];
      const p2 = coords[i];
      const ratio = (targetDist - cumulativeDists[i-1]) / (cumulativeDists[i] - cumulativeDists[i-1]);
      const pos: [number, number] = [
        p1[0] + (p2[0] - p1[0]) * ratio,
        p1[1] + (p2[1] - p1[1]) * ratio
      ];
      const b = bearing(point(p1), point(p2));
      return { pos, bearing: b };
    }
  }
  
  const lastB = coords.length >= 2 ? bearing(point(coords[coords.length - 2]), point(coords[coords.length - 1])) : 0;
  return { pos: coords[coords.length - 1] as [number, number], bearing: lastB };
};

// Slice coordinates based on distance metrics
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
  const accumulatedBearingRef = useRef<number>(NaN);
  
  // Theme and UI States
  const theme = 'dark';
  const [activeTab, setActiveTab] = useState<'route-weather' | 'fleet' | 'history' | 'ai-insights'>('route-weather');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [detailedCheckpoint, setDetailedCheckpoint] = useState<any | null>(null);
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [isSnapshotMode, setIsSnapshotMode] = useState(false);
  
  // Route Inputs
  const [originInput, setOriginInput] = useState("San Francisco, CA");
  const [destInput, setDestInput] = useState("Lake Tahoe, CA");
  const [departureOffset, setDepartureOffset] = useState<number>(0);
  
  // Route Data & Loading
  const [isLoading, setIsLoading] = useState(false);
  const [routeData, setRouteData] = useState<{
    originName: string;
    destName: string;
    totalDistanceMi: number;
    totalTimeMins: number;
    routeLine: any;
    cumulativeDistances: number[];
    segments: any[];
    overallRisk: number;
  } | null>(null);

  // Animation Progress (0 to 1)
  const [routeState, setRouteState] = useState<'hidden' | 'animating' | 'visible'>('hidden');
  const [progress, setProgress] = useState(0);

  // Client-Side History Persistence
  const [history, setHistory] = useState<any[]>([]);

  // Mock Fleet Data
  const [fleet] = useState([
    { 
      id: 'fleet-1', 
      name: 'Freightliner M2', 
      driver: 'Sarah Jenkins', 
      status: 'En Route', 
      origin: 'San Francisco, CA', 
      dest: 'Lake Tahoe, CA', 
      distanceRemaining: 195, 
      eta: '3h 15m', 
      weather: 'Clear', 
      risk: 'safe' 
    },
    { 
      id: 'fleet-2', 
      name: 'Sprinter Cargo 208', 
      driver: 'Marcus Vance', 
      status: 'En Route', 
      origin: 'Bangalore, India', 
      dest: 'Mysore, India', 
      distanceRemaining: 86, 
      eta: '2h 10m', 
      weather: 'Rain', 
      risk: 'warning' 
    },
    { 
      id: 'fleet-3', 
      name: 'Volvo VNL Heavy', 
      driver: 'Elena Rostova', 
      status: 'Idle', 
      origin: 'New York, NY', 
      dest: 'Boston, MA', 
      distanceRemaining: 0, 
      eta: '-', 
      weather: 'Snow', 
      risk: 'critical' 
    },
  ]);

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load theme and history on mount
  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const saved = localStorage.getItem('route_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  const saveHistory = (updated: any[]) => {
    setHistory(updated);
    localStorage.setItem('route_history', JSON.stringify(updated));
  };

  const clearHistory = () => {
    saveHistory([]);
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    saveHistory(history.filter(item => item.id !== id));
  };

  const calculateRoute = async (overrideOrigin?: string, overrideDest?: string) => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    return new Promise<void>((resolve) => {
      debounceTimeoutRef.current = setTimeout(async () => {
        setIsLoading(true);
        setRouteState('hidden');
        setDetailedCheckpoint(null);
        setShowShareMenu(false);
        accumulatedBearingRef.current = NaN;
        
        const oInput = overrideOrigin || originInput;
        const dInput = overrideDest || destInput;
        
        if (!oInput.trim() || !dInput.trim()) {
          setIsLoading(false);
          alert("Origin and Destination cannot be empty.");
          resolve();
          return;
        }

        try {
          const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';
          const departureTime = departureOffset > 0 
            ? new Date(Date.now() + departureOffset * 60 * 60 * 1000).toISOString() 
            : undefined;

          const response = await fetch(`${API_BASE}/api/route-weather`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              origin: oInput,
              destination: dInput,
              departureTime
            })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || errorData.error?.code || "Failed to fetch route and weather");
          }

          const resData = await response.json();
          const { geometry, durationSeconds, checkpoints, origin: originObj, destination: destObj } = resData.data;

          // Recreate cumulative distances on frontend
          let cumulativeDistances = [0];
          for (let i = 1; i < geometry.coordinates.length; i++) {
            const p1 = point(geometry.coordinates[i-1]);
            const p2 = point(geometry.coordinates[i]);
            cumulativeDistances.push(cumulativeDistances[i-1] + distance(p1, p2, { units: 'miles' }));
          }
          const totalDistanceMi = cumulativeDistances[cumulativeDistances.length - 1];
          const totalTimeMins = Math.round(durationSeconds / 60);
          
          const routeFeature = { type: 'Feature', geometry, properties: {} } as any;

          // Calculate Overall Risk
          const total = checkpoints.length;
          const critical = checkpoints.filter((s: any) => s.weather.severity === 'critical').length;
          const warning = checkpoints.filter((s: any) => s.weather.severity === 'warning').length;
          const overallRisk = Math.round(((total - critical - (warning * 0.5)) / total) * 100);

          setRouteData({
            originName: originObj.name,
            destName: destObj.name,
            totalDistanceMi,
            totalTimeMins,
            routeLine: routeFeature,
            cumulativeDistances,
            segments: checkpoints,
            overallRisk
          });

          // Frame route on map
          if (mapRef.current) {
             const lons = geometry.coordinates.map((c: any) => c[0]);
             const lats = geometry.coordinates.map((c: any) => c[1]);
             mapRef.current.fitBounds(
               [
                 [Math.min(...lons), Math.min(...lats)],
                 [Math.max(...lons), Math.max(...lats)]
               ],
               { padding: 80, duration: 1500 }
             );
          }
          
          // Start animation
          setRouteState('animating');
          setProgress(0);

          // Update URL
          const url = new URL(window.location.href);
          url.searchParams.set('origin', oInput);
          url.searchParams.set('dest', dInput);
          window.history.replaceState({}, '', url.toString());

          // Add to Local History
          const newHistoryItem = {
            id: Date.now().toString(),
            origin: originObj.name,
            dest: destObj.name,
            timestamp: new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            distance: Math.round(totalDistanceMi),
            duration: `${Math.floor(totalTimeMins / 60)}h ${totalTimeMins % 60}m`,
            risk: overallRisk,
            weatherSummary: checkpoints[Math.floor(checkpoints.length / 2)]?.weather.condition || 'Clear'
          };
          
          setHistory(prev => {
            const filtered = prev.filter(h => !(h.origin.toLowerCase() === originObj.name.toLowerCase() && h.dest.toLowerCase() === destObj.name.toLowerCase()));
            const updated = [newHistoryItem, ...filtered].slice(0, 25);
            localStorage.setItem('route_history', JSON.stringify(updated));
            return updated;
          });

        } catch (e: any) {
          console.error(e);
          alert(e.message || "Error calculating route. Please check the cities.");
        } finally {
          setIsLoading(false);
          resolve();
        }
      }, 300);
    });
  };

  // Run animation progress loop
  useEffect(() => {
    if (routeState !== 'animating' || !routeData) return;

    let animationFrame: number;
    let startTime: number | null = null;
    const ANIMATION_DURATION_MS = 2500; // Smooth 2.5s drawing animation

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      
      const t = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      const easeOut = 1 - Math.pow(1 - t, 3); // Ease-out cubic

      setProgress(easeOut);
      
      if (easeOut >= 1) {
        setProgress(1);
        setRouteState('visible');
        return;
      }

      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [routeState, routeData]);

  // Load from URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const originParam = params.get('origin');
    const destParam = params.get('dest');

    if (originParam && destParam) {
      setOriginInput(originParam);
      setDestInput(destParam);
      calculateRoute(originParam, destParam);
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
    map.resize();
    
    if (routeData) {
      const lons = routeData.routeLine.geometry.coordinates.map((c: any) => c[0]);
      const lats = routeData.routeLine.geometry.coordinates.map((c: any) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)]
        ],
        { padding: { top: 80, bottom: 80, left: 450, right: 80 }, duration: 0 }
      );
    }
    
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
        setTimeout(doResolve, 1500);
      }
    });
    
    await new Promise(r => setTimeout(r, 300)); 
    try {
      const mapCanvas = map.getCanvas();
      const mapDataUrl = mapCanvas.toDataURL('image/png');

      const uiDataUrl = await toPng(containerRef.current, { 
        cacheBust: true, 
        pixelRatio: window.devicePixelRatio || 2,
        backgroundColor: 'rgba(0,0,0,0)',
        filter: (node: HTMLElement) => {
          if (node.tagName === 'CANVAS' && node.classList.contains('maplibregl-canvas')) {
            return false;
          }
          return true;
        }
      });

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

      ctx.drawImage(mapImg, 0, 0);
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
          text: `Check out my RouteWeather trip from ${originInput} to ${destInput}!`,
          url: url.toString()
      };

      if (navigator.canShare && navigator.canShare(shareData)) {
          await navigator.share(shareData);
      } else {
          alert("Native sharing not supported on this device. Copy link instead.");
      }
    } catch (err: any) {
        if (err.name !== 'AbortError') {
            console.error("Error sharing", err);
        }
    }
  };

  // Render Functions for Tab Contents
  const renderRouteWeatherTab = () => {
    return (
      <>
        {/* Card 1: Route Inputs */}
        <div className="dash-glass p-4 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex flex-col gap-3">
          <h3 className="text-dash-label font-bold mb-1">Route Search</h3>
          <div className="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2 border border-white/5 focus-within:border-white/20 transition-colors">
            <MapPin size={16} className="text-white/40" />
            <input 
              type="text" 
              value={originInput}
              onChange={e => setOriginInput(e.target.value)}
              className="bg-transparent border-none outline-none text-xs w-full text-white placeholder-white/20" 
              placeholder="Origin location..."
            />
          </div>
          
          <div className="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2 border border-white/5 focus-within:border-white/20 transition-colors">
            <Flag size={16} className="text-white/40" />
            <input 
              type="text" 
              value={destInput}
              onChange={e => setDestInput(e.target.value)}
              className="bg-transparent border-none outline-none text-xs w-full text-white placeholder-white/20" 
              placeholder="Destination..."
            />
          </div>

          <div className="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2 border border-white/5 focus-within:border-white/20 transition-colors">
            <Clock size={16} className="text-white/40" />
            <select 
              value={departureOffset} 
              onChange={e => setDepartureOffset(Number(e.target.value))}
              className="bg-transparent border-none outline-none text-xs w-full text-white cursor-pointer"
            >
              <option value={0} className="bg-zinc-950 text-white">Leave Now</option>
              <option value={1} className="bg-zinc-950 text-white">In 1 Hour</option>
              <option value={2} className="bg-zinc-950 text-white">In 2 Hours</option>
              <option value={4} className="bg-zinc-950 text-white">In 4 Hours</option>
              <option value={6} className="bg-zinc-950 text-white">In 6 Hours</option>
              <option value={12} className="bg-zinc-950 text-white">In 12 Hours</option>
            </select>
          </div>

          <button 
            onClick={() => calculateRoute()}
            disabled={isLoading || routeState === 'animating'}
            className="w-full bg-white text-zinc-950 font-bold py-2 px-4 rounded-xl text-xs hover:bg-white/90 transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1 cursor-pointer"
          >
            {isLoading ? (
              <>
                <SpinnerGap size={14} className="animate-spin" />
                Calculating...
              </>
            ) : routeState === 'animating' ? 'Plotting Route...' : 'Generate Route'}
          </button>
        </div>

        {routeData ? (
          <>
            {/* Card 2: Slim Status Row */}
            <div className="dash-glass px-4 py-3 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">Optimal Stops</span>
                <span className="text-xs font-mono font-bold text-white">{routeData.segments.filter(s => s.weather.severity === 'safe').length}</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">Risk Stops</span>
                <span className="text-xs font-mono font-bold text-white">{routeData.segments.filter(s => s.weather.severity !== 'safe').length}</span>
              </div>
            </div>

            {/* Card 3: Hero Metric */}
            <div className="dash-glass p-4 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex flex-col shrink-0">
              <h3 className="text-dash-label font-bold">Route Safety Index</h3>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-light text-white">{100 - routeData.overallRisk}</span>
                <span className="text-[10px] text-white/40 font-mono">/ 100</span>
              </div>

              {/* Live Sparkline representing Temperature Profile */}
              {(() => {
                const temps = routeData.segments.map(s => s.weather.temperatureC);
                const minTemp = Math.min(...temps);
                const maxTemp = Math.max(...temps);
                const tempRange = maxTemp - minTemp || 1;
                const points = routeData.segments.map((s, idx) => {
                  const x = (idx / (routeData.segments.length - 1)) * 100;
                  const y = 30 - ((s.weather.temperatureC - minTemp) / tempRange) * 20 - 5;
                  return `${x},${y}`;
                }).join(' ');

                return (
                  <div className="relative mt-4">
                    <svg className="w-full h-12 overflow-visible" viewBox="0 0 100 30" preserveAspectRatio="none">
                      <path 
                        d={`M ${points}`} 
                        fill="none" 
                        stroke="#ffffff" 
                        strokeWidth="1.5" 
                        className="animate-draw"
                      />
                    </svg>
                    <div className="flex justify-between text-[8px] text-white/30 font-mono mt-1 select-none">
                      <span>{UNIT_CONFIG.formatTemp(minTemp)}</span>
                      <span className="uppercase tracking-wider">Temp Profile</span>
                      <span>{UNIT_CONFIG.formatTemp(maxTemp)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Card 4: Weather Stops List */}
            <div className="dash-glass p-4 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex-1 flex flex-col min-h-0 overflow-hidden">
              <h3 className="text-dash-label font-bold mb-3">Weather Checkpoints</h3>
              <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-2">
                {routeData.segments.map((seg, idx) => {
                  const Icon = IconMap[seg.weather.icon] || Sun;
                  const isSafe = seg.weather.severity === 'safe';
                  const currentDist = progress * routeData.totalDistanceMi;
                  const isCurrent = currentDist >= seg.distanceFromStartMi;
                  
                  return (
                    <div 
                      key={seg.id}
                      onClick={() => setDetailedCheckpoint(seg)}
                      className="bg-white/[0.02] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 p-3 rounded-xl transition-all duration-150 cursor-pointer flex flex-col gap-2"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`p-1.5 rounded-lg bg-white/5 text-white ${!isSafe ? 'text-[#ef4444]' : 'text-white'}`}>
                            <Icon size={14} weight="duotone" />
                          </div>
                          <div>
                            <h4 className="text-[11px] font-bold text-white truncate max-w-[160px]">{seg.locationName.split('(')[0]}</h4>
                            <div className="text-[8px] text-white/40 font-mono mt-0.5">
                              {seg.timeFromStartMins === 0 ? 'Departure' : `+${seg.timeFromStartMins}m`} • ETA {new Date(seg.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex flex-col items-end shrink-0">
                          <span className="text-[11px] font-bold text-white font-mono">{UNIT_CONFIG.formatTemp(seg.weather.temperatureC)}</span>
                          <span className={`text-[8px] font-bold uppercase tracking-wider mt-0.5 
                            ${isSafe ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                            {seg.weather.condition.split(' ')[0]}
                          </span>
                        </div>
                      </div>

                      {/* Thin Progress bar */}
                      <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-white transition-all duration-300"
                          style={{ 
                            width: `${isCurrent ? 100 : (idx > 0 && currentDist > routeData.segments[idx - 1].distanceFromStartMi) ? Math.round(((currentDist - routeData.segments[idx-1].distanceFromStartMi) / (seg.distanceFromStartMi - routeData.segments[idx-1].distanceFromStartMi)) * 100) : 0}%` 
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="dash-glass p-6 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex-1 flex flex-col items-center justify-center text-center text-white/40 gap-2">
            <MapPin size={24} className="opacity-50" />
            <p className="text-xs max-w-[220px] leading-relaxed">Enter locations and trigger route mapping to obtain weather intelligence along your path.</p>
          </div>
        )}
      </>
    );
  };

  const renderFleetTab = () => {
    const onlineVehicles = fleet.filter(v => v.risk === 'safe').length;
    const offlineVehicles = fleet.filter(v => v.risk !== 'safe').length;

    return (
      <>
        {/* Card 1: Slim Status Overview */}
        <div className="dash-glass px-4 py-3 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">Online</span>
            <span className="text-xs font-mono font-bold text-white">{onlineVehicles}</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">Offline / Risk</span>
            <span className="text-xs font-mono font-bold text-white">{offlineVehicles}</span>
          </div>
        </div>

        {/* Card 2: Fleet Scrollable List */}
        <div className="dash-glass p-4 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex-1 flex flex-col min-h-0 overflow-hidden">
          <h3 className="text-dash-label font-bold mb-3">Active Logistics</h3>
          <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-3">
            {fleet.map((vehicle) => {
              const isSafe = vehicle.risk === 'safe';
              return (
                <div 
                  key={vehicle.id}
                  onClick={() => {
                    if (vehicle.status === 'En Route') {
                      setOriginInput(vehicle.origin);
                      setDestInput(vehicle.dest);
                      calculateRoute(vehicle.origin, vehicle.dest);
                      setActiveTab('route-weather');
                    }
                  }}
                  className="bg-white/[0.02] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 p-3 rounded-xl transition-all duration-150 cursor-pointer flex flex-col gap-2"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Truck size={14} className="opacity-80" />
                        {vehicle.name}
                      </h4>
                      <span className="text-[9px] text-white/40 mt-0.5 block">Driver: {vehicle.driver}</span>
                    </div>
                    <span className={`text-[8px] uppercase font-bold px-2 py-0.5 rounded-full border
                      ${isSafe 
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                        : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                      {vehicle.status}
                    </span>
                  </div>

                  <div className="text-[10px] font-semibold text-white/60 flex items-center gap-1">
                    <span>{vehicle.origin.split(',')[0]}</span>
                    <span className="opacity-30">→</span>
                    <span>{vehicle.dest.split(',')[0]}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 text-[9px] text-white/50">
                    <div>
                      <span className="block text-[7px] uppercase tracking-wider text-white/30">Weather</span>
                      <span className="text-white flex items-center gap-1 mt-0.5">
                        {vehicle.weather === 'Clear' ? <Sun size={10} /> : <CloudRain size={10} />}
                        {vehicle.weather}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[7px] uppercase tracking-wider text-white/30">ETA</span>
                      <span className="text-white mt-0.5 block">{vehicle.eta} ({vehicle.distanceRemaining} mi)</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  const renderHistoryTab = () => {
    return (
      <>
        {/* Card 1: History Header */}
        <div className="dash-glass p-4 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex justify-between items-center shrink-0">
          <h3 className="text-dash-label font-bold">Search History</h3>
          {history.length > 0 && (
            <button 
              onClick={clearHistory}
              className="text-[9px] uppercase tracking-wider font-extrabold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 rounded-lg transition-all cursor-pointer border border-rose-500/10"
            >
              Clear All
            </button>
          )}
        </div>

        {/* Card 2: Scrollable History Card */}
        <div className="dash-glass p-4 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-2.5">
            {history.length > 0 ? (
              history.map((item) => {
                const isSafe = item.risk < 40;
                return (
                  <div 
                    key={item.id}
                    onClick={() => {
                      setOriginInput(item.origin);
                      setDestInput(item.dest);
                      calculateRoute(item.origin, item.dest);
                      setActiveTab('route-weather');
                    }}
                    className="bg-white/[0.02] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 p-3 rounded-xl transition-all duration-150 cursor-pointer flex flex-col gap-2 relative group"
                  >
                    <div className="pr-8">
                      <div className="text-xs font-bold text-white flex items-center gap-1.5 truncate">
                        <span>{item.origin.split(',')[0]}</span>
                        <span className="opacity-30">→</span>
                        <span>{item.dest.split(',')[0]}</span>
                      </div>
                      <span className="text-[8px] text-white/40 font-mono mt-0.5 block">{item.timestamp}</span>
                    </div>

                    <div className="flex gap-3 text-[9px] text-white/50 font-mono pt-2 border-t border-white/5">
                      <span>{item.distance} mi</span>
                      <span className="opacity-20">|</span>
                      <span>{item.duration}</span>
                      <span className="opacity-20">|</span>
                      <span className={`font-bold ${isSafe ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                        Score: {100 - item.risk}
                      </span>
                    </div>

                    <button 
                      onClick={(e) => deleteHistoryItem(item.id, e)}
                      className="absolute top-2.5 right-2.5 p-1 text-white/40 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      title="Delete Record"
                    >
                      <Trash size={12} />
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center text-center text-white/40 h-full gap-1.5 py-6">
                <HistoryIcon size={20} className="opacity-50" />
                <p className="text-xs font-semibold">No recent searches</p>
              </div>
            )}
          </div>
        </div>
      </>
    );
  };

  const renderAIInsightsTab = () => {
    if (!routeData) {
      return (
        <div className="dash-glass p-6 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex-1 flex flex-col items-center justify-center text-center text-white/40 gap-2">
          <Brain size={24} className="opacity-50" />
          <p className="text-xs max-w-[220px] leading-relaxed">Generate a route to obtain meteorological risk assessments and smart travel recommendations.</p>
        </div>
      );
    }

    const totalCheckpoints = routeData.segments.length;
    const criticalPoints = routeData.segments.filter(s => s.weather.severity === 'critical');
    const warningPoints = routeData.segments.filter(s => s.weather.severity === 'warning');

    const hasSnow = routeData.segments.some(s => s.weather.condition.toLowerCase().includes('snow'));
    const hasRain = routeData.segments.some(s => s.weather.condition.toLowerCase().includes('rain') || s.weather.condition.toLowerCase().includes('drizzle'));
    const hasFog = routeData.segments.some(s => s.weather.condition.toLowerCase().includes('fog'));
    const hasHighWind = routeData.segments.some(s => s.weather.windSpeedMph > 25);
    const hasFreezing = routeData.segments.some(s => s.weather.temperatureC < 3);

    const warnings = [];
    if (hasSnow) {
      warnings.push({
        type: 'critical',
        title: 'Road Rime & Snowfall Hazard',
        text: 'Sub-zero temperatures paired with active snowfall are forecasted. Winter tires or chains are highly recommended to combat icy roads.'
      });
    }
    if (hasRain) {
      const heavyRainPt = routeData.segments.find(s => s.weather.condition.toLowerCase().includes('heavy rain'));
      warnings.push({
        type: 'warning',
        title: 'Wet Road Surfaces & Hydroplaning',
        text: heavyRainPt 
          ? `Heavy rainfall expected near ${heavyRainPt.locationName}. High risk of water pooling. Keep speed low.` 
          : 'Active rainfall detected. Braking distances will increase. Maintain standard safety offsets.'
      });
    }
    if (hasFog) {
      const fogPt = routeData.segments.find(s => s.weather.condition.toLowerCase().includes('fog'));
      warnings.push({
        type: 'warning',
        title: 'Substantial Fog & Obscured Visibility',
        text: `Visibility drops near ${fogPt?.locationName || 'checkpoints'}. Use fog lights and avoid tailgating.`
      });
    }
    if (hasHighWind) {
      const windPt = routeData.segments.find(s => s.weather.windSpeedMph > 25);
      warnings.push({
        type: 'warning',
        title: 'High Velocity Crosswinds',
        text: `Crosswinds reaching ${windPt?.weather.windSpeedMph || 25} mph expected near ${windPt?.locationName || 'checkpoints'}. High-profile vehicles should stay cautious.`
      });
    }
    if (hasFreezing && !hasSnow) {
      warnings.push({
        type: 'warning',
        title: 'Sub-freezing Road Surface Danger',
        text: 'Temperatures are dropping near freezing. Watch out for black ice on bridges and overpasses.'
      });
    }

    let summaryText = " Favorable conditions expected across the entire route.";
    if (criticalPoints.length > 0) {
      summaryText = ` Severe meteorological hazards detected at ${criticalPoints.length} checkpoints. Exercise extreme caution.`;
    } else if (warningPoints.length > 0) {
      summaryText = ` Favorable weather generally, but moderate caution is advised due to transitions near ${warningPoints[0].locationName}.`;
    }

    return (
      <>
        {/* Card 1: Route Analysis */}
        <div className="dash-glass p-4 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex flex-col shrink-0">
          <h3 className="text-dash-label mb-2">Route Analysis</h3>
          <p className="text-xs leading-relaxed text-white font-medium">
            Your trip spans {Math.round(routeData.totalDistanceMi)} miles and passes through {totalCheckpoints} weather checkpoints.{summaryText}
          </p>
        </div>

        {/* Card 2: AI Weather Alerts */}
        {warnings.length > 0 && (
          <div className="dash-glass p-4 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex flex-col gap-2.5 shrink-0">
            <h3 className="text-dash-label">Hazards & Action Plan</h3>
            <div className="flex flex-col gap-2 max-h-36 overflow-y-auto no-scrollbar">
              {warnings.map((warn, i) => (
                <div 
                  key={i} 
                  className={`p-2.5 border rounded-xl flex gap-2 
                    ${warn.type === 'critical' 
                      ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' 
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-300'}`}
                >
                  <Warning size={14} className="shrink-0 mt-0.5" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-wider">{warn.title}</span>
                    <p className="text-[9px] leading-relaxed opacity-90 mt-0.5">{warn.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Card 3: Timeline Forecast */}
        <div className="dash-glass p-4 pointer-events-auto bg-zinc-950/85 border border-white/10 shadow-2xl rounded-2xl flex-1 flex flex-col min-h-0 overflow-hidden">
          <h3 className="text-dash-label mb-3">Future Travel Forecast</h3>
          <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col relative pl-5 border-l border-white/10 ml-2 gap-4 py-2">
            {routeData.segments.map((seg, index) => {
              const Icon = IconMap[seg.weather.icon] || Sun;
              const formattedTime = new Date(seg.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const isSafe = seg.weather.severity === 'safe';
              
              return (
                <div key={seg.id} className="relative flex flex-col">
                  {/* Timeline Dot */}
                  <div className="absolute -left-[26px] top-1.5 w-2.5 h-2.5 rounded-full bg-zinc-950 border border-white/20 flex items-center justify-center">
                    <div className={`w-1.5 h-1.5 rounded-full ${isSafe ? 'bg-[#10b981]' : 'bg-[#ef4444]'}`} />
                  </div>
                  
                  {/* Content */}
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="text-[11px] font-bold text-white leading-tight">{seg.locationName.split('(')[0]}</h4>
                      <span className="text-[8px] text-white/40 mt-0.5 block font-mono">
                        {index === 0 ? 'Departure' : `+${seg.timeFromStartMins}m`} • ETA {formattedTime}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Icon size={12} weight="duotone" className="text-white/60" />
                      <span className="text-[10px] font-bold text-white font-mono">{UNIT_CONFIG.formatTemp(seg.weather.temperatureC)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  return (
    <div ref={containerRef} className={`relative w-full h-screen overflow-hidden text-white font-sans flex ${isSnapshotMode ? 'bg-transparent pointer-events-none snapshot-mode' : 'bg-[#0a0a0b]'}`}>
      <style>
        {isSnapshotMode && `
          .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-top-left, .maplibregl-ctrl-top-right {
            display: none !important;
          }
        `}
      </style>

      {/* Floating Pill Top Navigation */}
      {!isSnapshotMode && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex items-center justify-between gap-6 px-6 py-2.5 rounded-full dash-glass bg-zinc-950/80 border border-white/10 shadow-2xl w-[90%] max-w-[800px] pointer-events-auto">
          <div className="flex items-center gap-2 select-none">
            <Brain size={18} weight="fill" className="text-white" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-white leading-none">RouteWeather</span>
          </div>
          <div className="flex items-center gap-1.5">
            {(['route-weather', 'fleet', 'history', 'ai-insights'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer select-none
                  ${activeTab === tab 
                    ? 'bg-white text-zinc-950 shadow-md font-bold' 
                    : 'text-white/60 hover:text-white/90 hover:bg-white/5'}`}
              >
                {tab === 'route-weather' ? 'Route Planner' : tab === 'ai-insights' ? 'AI Insights' : tab}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Large Floating Route Map Title */}
      {!isSnapshotMode && routeData && (
        <div className="absolute top-24 left-[450px] z-10 pointer-events-none flex flex-col gap-2">
          <h1 className="text-3xl font-light tracking-wide text-white drop-shadow">Weather Intelligence</h1>
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="dash-glass bg-zinc-950/80 border border-white/10 px-3 py-1 rounded-xl text-[9px] font-bold uppercase tracking-wider text-white/80 flex items-center gap-1.5 cursor-default">
              <MapPin size={10} />
              {routeData.originName.split(',')[0]} → {routeData.destName.split(',')[0]}
            </div>
            <div className="dash-glass bg-zinc-950/80 border border-white/10 px-3 py-1 rounded-xl text-[9px] font-bold uppercase tracking-wider text-white/80 flex items-center gap-1.5 cursor-default">
              <Clock size={10} />
              ETA {Math.round(routeData.totalTimeMins)}m ({Math.round(routeData.totalDistanceMi)} mi)
            </div>
          </div>
        </div>
      )}

      {/* Top right sharing triggers */}
      {!isSnapshotMode && routeData && (
        <div className="absolute top-6 right-6 z-20 flex gap-2 pointer-events-auto">
          <div className="relative">
            <button 
              onClick={() => setShowShareMenu(!showShareMenu)}
              className="dash-glass px-4 py-2 text-xs font-bold flex items-center gap-2 shadow-2xl hover:bg-white/10 transition-colors text-white bg-zinc-950/80 border border-white/10 cursor-pointer"
            >
              <ShareNetwork size={14} />
              Share
            </button>

            {showShareMenu && (
              <div className="absolute right-0 mt-2 w-48 dash-glass bg-zinc-950/95 border border-white/10 shadow-2xl rounded-xl py-1 z-30 animate-in fade-in slide-in-from-top-2 duration-150">
                <button 
                  onClick={handleCopyLink}
                  className="w-full px-4 py-2.5 text-xs text-left text-white hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Link size={14} />
                  Copy Link
                </button>
                <button 
                  onClick={handleDownloadImage}
                  className="w-full px-4 py-2.5 text-xs text-left text-white hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <ImageIcon size={14} />
                  Save Image (PNG)
                </button>
                <button 
                  onClick={handleNativeShare}
                  className="w-full px-4 py-2.5 text-xs text-left text-white hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Export size={14} />
                  Native Share
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
          canvasContextAttributes={{ preserveDrawingBuffer: true }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={getHybridMapStyle() as any}
        >
          {/* Glowing Route Line Segments sliced along REAL road geometry */}
          {(routeState === 'animating' || routeState === 'visible') && routeData && routeData.segments.slice(0, -1).map((seg, i) => {
            const nextSeg = routeData.segments[i + 1];
            
            const distToStart = seg.distanceFromStartMi;
            const distToEnd = nextSeg.distanceFromStartMi;
            const currentDist = progress * routeData.totalDistanceMi;

            let segmentGeoJsonCoords: number[][] = [];

            if (currentDist >= distToEnd) {
              segmentGeoJsonCoords = getSlicedCoordinates(routeData.routeLine.geometry.coordinates, routeData.cumulativeDistances, distToStart, distToEnd);
            } else if (currentDist > distToStart) {
              segmentGeoJsonCoords = getSlicedCoordinates(routeData.routeLine.geometry.coordinates, routeData.cumulativeDistances, distToStart, currentDist);
            } else {
              return null;
            }

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
                {/* Subtle White Glow Underlay */}
                <Layer
                  id={`route-line-${seg.id}`}
                  type="line"
                  paint={{
                    'line-color': 'rgba(255, 255, 255, 0.25)',
                    'line-width': 6,
                    'line-blur': 2.5
                  }}
                />
                {/* Core White Dashed Route Line */}
                <Layer
                  id={`route-line-core-${seg.id}`}
                  type="line"
                  paint={{
                    'line-color': '#ffffff',
                    'line-width': 2,
                    'line-dasharray': [2, 3]
                  }}
                />
              </Source>
            );
          })}

          {/* Vehicle Indicator */}
          {!isSnapshotMode && routeData && (routeState === 'animating' || routeState === 'visible') && (() => {
            const currentDistance = routeData.totalDistanceMi * progress;
            const { pos: currentVehiclePos, bearing: currentBearing } = getPointAtDistance(
              routeData.routeLine.geometry.coordinates,
              routeData.cumulativeDistances,
              currentDistance
            );
            
            if (!currentVehiclePos) return null;
            
            // Normalize bearing and accumulate to avoid 360 spin artifacts
            let prevAccum = accumulatedBearingRef.current;
            if (isNaN(prevAccum) || prevAccum === null || prevAccum === undefined) {
              accumulatedBearingRef.current = currentBearing;
            } else {
              let diff = currentBearing - (prevAccum % 360);
              if (diff > 180) diff -= 360;
              if (diff < -180) diff += 360;
              accumulatedBearingRef.current = prevAccum + diff;
            }
            
            return (
              <Marker
                longitude={currentVehiclePos[0]}
                latitude={currentVehiclePos[1]}
                anchor="center"
                style={{ zIndex: 40 }}
              >
                <div className="relative flex items-center justify-center pointer-events-none">
                  <div className="absolute w-8 h-8 bg-white border border-white rounded-full opacity-20 animate-ping"></div>
                  <div 
                    className="w-6 h-6 bg-white border-2 border-zinc-950 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(0,0,0,0.5)]"
                    style={{ transform: `rotate(${accumulatedBearingRef.current}deg)` }}
                  >
                    <svg className="w-3.5 h-3.5 text-zinc-950" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L4.5 20.29l.71.71L12 17l6.79 4 .71-.71z" />
                    </svg>
                  </div>
                </div>
              </Marker>
            );
          })()}

          {/* Markers for Weather Points */}
          {routeData && routeData.segments.map((seg) => {
            let isVisible = false;
            if (routeState === 'visible' || isSnapshotMode) {
              isVisible = true;
            } else if (routeState === 'animating') {
              const currentDist = progress * routeData.totalDistanceMi;
              isVisible = currentDist >= seg.distanceFromStartMi;
            }
            
            if (!isVisible) return null;

            const isHovered = hoveredMarkerId === seg.id;

            return (
              <Marker
                key={`marker-${seg.id}`}
                longitude={seg.coordinates[0]}
                latitude={seg.coordinates[1]}
                anchor="bottom"
                style={{ zIndex: isHovered && !isSnapshotMode ? 50 : 30 }}
              >
                <div className="relative">
                  {/* Contextual Tooltip */}
                  {!isSnapshotMode && isHovered && (
                    <div className="absolute bottom-full mb-3.5 -translate-x-1/2 left-1/2 flex flex-col items-center animate-in fade-in zoom-in-95 duration-150 pointer-events-none z-50">
                      <div className="dash-glass px-4 py-2.5 shadow-2xl text-left rounded-xl bg-zinc-950/90 border border-white/10 w-44">
                        <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest truncate">{seg.locationName.split('(')[0]}</div>
                        <div className="flex justify-between items-baseline mt-1.5">
                          <span className="text-lg font-light text-white leading-none font-mono">{UNIT_CONFIG.formatTemp(seg.weather.temperatureC)}</span>
                          <span className="text-[8px] font-bold uppercase tracking-wider text-white/40">{seg.weather.condition.split(' ')[0]}</span>
                        </div>
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
                      setDetailedCheckpoint(seg);
                    }}
                    className={`flex items-center justify-center transition-transform duration-200
                      ${isHovered && !isSnapshotMode ? 'scale-125' : (!isSnapshotMode ? 'hover:scale-115 cursor-pointer' : '')}
                      animate-in fade-in zoom-in`}
                  >
                    <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-zinc-950 shadow-[0_0_8px_rgba(0,0,0,0.6)] flex items-center justify-center transition-colors animate-gentle-pulse" />
                  </div>
                </div>
              </Marker>
            );
          })}
        </Map>
      </div>

      {/* Transparent Sidebar Panel Stacker */}
      {!isSnapshotMode && !isSidebarCollapsed && (
        <div className="absolute left-6 top-24 bottom-6 w-[400px] z-20 flex flex-col pointer-events-none select-none animate-in fade-in slide-in-from-left-4 duration-300 gap-4 min-h-0">
          <div className="flex items-center justify-between pointer-events-auto shrink-0 pr-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Dashboard Panel</span>
            <button 
              onClick={() => setIsSidebarCollapsed(true)}
              className="p-1 hover:bg-white/10 rounded-lg text-white/50 hover:text-white transition-colors cursor-pointer"
              title="Collapse Sidebar"
            >
              <CaretLeft size={16} />
            </button>
          </div>
          
          {activeTab === 'route-weather' && renderRouteWeatherTab()}
          {activeTab === 'fleet' && renderFleetTab()}
          {activeTab === 'history' && renderHistoryTab()}
          {activeTab === 'ai-insights' && renderAIInsightsTab()}
        </div>
      )}

      {/* Collapse Trigger */}
      {!isSnapshotMode && isSidebarCollapsed && (
        <button 
          onClick={() => setIsSidebarCollapsed(false)}
          className="absolute top-24 left-6 z-20 w-10 h-10 dash-glass flex items-center justify-center shadow-2xl hover:bg-white/15 transition-all active:scale-95 text-white cursor-pointer animate-in fade-in bg-zinc-950/80 border border-white/10"
          title="Expand Sidebar"
        >
          <CaretRight size={18} />
        </button>
      )}

      {/* Zoom controls on map */}
      {!isSnapshotMode && (
        <div className="absolute bottom-6 left-[450px] z-10 flex items-center gap-1.5 p-1 rounded-full dash-glass bg-zinc-950/80 border border-white/10 pointer-events-auto shadow-2xl">
          <button 
            onClick={() => mapRef.current?.zoomIn()}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-xs font-bold"
            title="Zoom In"
          >
            +
          </button>
          <div className="w-px h-3 bg-white/10" />
          <button 
            onClick={() => mapRef.current?.zoomOut()}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/75 hover:text-white hover:bg-white/10 transition-colors cursor-pointer text-xs font-bold"
            title="Zoom Out"
          >
            −
          </button>
        </div>
      )}

      {/* Bottom Right Conditions Summary */}
      {!isSnapshotMode && routeData && (
        <div className="absolute bottom-6 right-6 z-10 w-[360px] dash-glass p-5 pointer-events-auto bg-zinc-950/85 border border-white/10 rounded-2xl shadow-2xl flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div>
            <div className="text-[10px] uppercase font-bold tracking-widest text-white/40 mb-1">Conditions Summary</div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-light text-white">{routeData.overallRisk}%</span>
              <span className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Overall Route Threat</span>
            </div>
          </div>
          
          <table className="w-full mt-1 border-collapse">
            <thead>
              <tr className="text-left text-[8px] uppercase tracking-wider text-white/40 font-bold">
                <th className="pb-1.5 font-bold">Checkpoint</th>
                <th className="pb-1.5 font-bold">Temp</th>
                <th className="pb-1.5 text-right font-bold">Risk Delta</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const originTemp = routeData.segments[0].weather.temperatureC;
                return routeData.segments.slice(1, 5).map((seg) => {
                  const tempDelta = seg.weather.temperatureC - originTemp;
                  const sign = tempDelta > 0 ? '+' : '';
                  const deltaColor = tempDelta > 0 ? 'text-[#ef4444]' : tempDelta < 0 ? 'text-sky-400' : 'text-white/40';
                  
                  return (
                    <tr key={seg.id} className="border-t border-white/5">
                      <td className="py-2 text-[10px] text-white/80 font-semibold truncate max-w-[120px]">{seg.locationName.split('(')[0]}</td>
                      <td className="py-2 text-[10px] font-mono text-white/90">{UNIT_CONFIG.formatTemp(seg.weather.temperatureC)}</td>
                      <td className={`py-2 text-[10px] font-mono font-bold text-right ${deltaColor}`}>
                        {tempDelta === 0 ? '0°C' : `${sign}${tempDelta}°C`}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Detailed Checkpoint Modal */}
      {detailedCheckpoint && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="dash-glass p-6 max-w-md w-full shadow-2xl relative border border-white/10 bg-zinc-950/90 animate-in zoom-in-95 duration-200 flex flex-col gap-4 text-left">
            <button 
              onClick={() => setDetailedCheckpoint(null)}
              className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg cursor-pointer"
            >
              <X size={18} />
            </button>
            
            <div>
              <div className="text-[10px] uppercase font-bold tracking-widest text-white/40 mb-1">Weather Station Detail</div>
              <h3 className="text-xl font-bold text-white leading-tight">{detailedCheckpoint.locationName}</h3>
              <div className="text-[10px] text-white/40 mt-1 font-mono">
                {detailedCheckpoint.coordinates[1].toFixed(4)}°N, {detailedCheckpoint.coordinates[0].toFixed(4)}°E
              </div>
            </div>

            <div className="flex items-center gap-4 py-4 border-y border-white/5">
              <div className="p-3 bg-white/5 rounded-2xl text-white">
                {(() => {
                  const Icon = IconMap[detailedCheckpoint.weather.icon] || Sun;
                  return <Icon size={40} weight="duotone" />;
                })()}
              </div>
              <div>
                <div className="text-[2.5rem] font-light leading-none font-mono text-white">
                  {UNIT_CONFIG.formatTemp(detailedCheckpoint.weather.temperatureC)}
                </div>
                <div className="text-xs font-medium text-white/55 mt-1 flex items-center gap-1.5">
                  <Thermometer size={14} />
                  Feels like {UNIT_CONFIG.formatTemp(detailedCheckpoint.weather.feelsLikeC)}
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-sm font-bold text-white">{detailedCheckpoint.weather.condition}</div>
                <div className="text-[10px] text-white/40 mt-1">
                  ETA: {new Date(detailedCheckpoint.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1.5">
                  <CloudRain size={12} />
                  Precipitation
                </div>
                <div className="text-xs font-semibold font-mono text-white">
                  {detailedCheckpoint.weather.rainProbability}% ({detailedCheckpoint.weather.precipitationIn} in)
                </div>
              </div>
              
              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1.5">
                  <Wind size={12} />
                  Wind
                </div>
                <div className="text-xs font-semibold font-mono text-white">
                  {detailedCheckpoint.weather.windSpeedMph} mph {detailedCheckpoint.weather.windDirection}
                </div>
              </div>

              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1.5">
                  <Drop size={12} />
                  Humidity
                </div>
                <div className="text-xs font-semibold font-mono text-white">
                  {detailedCheckpoint.weather.humidity}%
                </div>
              </div>

              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1.5">
                  <Eye size={12} />
                  Visibility
                </div>
                <div className="text-xs font-semibold font-mono text-white">
                  {detailedCheckpoint.weather.visibilityMi} mi
                </div>
              </div>

              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1.5">
                  <Cloud size={12} />
                  Cloud Cover
                </div>
                <div className="text-xs font-semibold font-mono text-white">
                  {detailedCheckpoint.weather.cloudCover}%
                </div>
              </div>

              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1.5">
                  <Info size={12} />
                  UV Index
                </div>
                <div className="text-xs font-semibold font-mono text-white">
                  {detailedCheckpoint.weather.uvIndex}
                </div>
              </div>
            </div>

            <div className={`p-4 rounded-xl border flex flex-col gap-1.5 mt-2
              ${detailedCheckpoint.weather.severity === 'safe' 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
              <div className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-1.5">
                <Warning size={12} weight="fill" />
                Risk Assessment: {detailedCheckpoint.weather.severity.toUpperCase()}
              </div>
              <p className="text-xs leading-relaxed font-medium">
                {detailedCheckpoint.weather.riskAssessment}
              </p>
              {detailedCheckpoint.alert && (
                <div className="text-[9px] font-bold mt-1 uppercase bg-white/10 px-2 py-0.5 rounded-md self-start border border-white/10">
                  Active Alert: {detailedCheckpoint.alert}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default App;
