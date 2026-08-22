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
  Info,
  MoonStars
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

// Get the visual color for a segment based on its weather conditions
const getSegmentColor = (seg: any) => {
  const severity = seg.weather?.severity;
  const condition = seg.weather?.condition || '';
  
  if (severity === 'critical') {
    if (condition.includes('Snow') || condition.includes('Ice')) return '#a855f7'; // Purple for snow/ice
    return '#ef4444'; // Red for storms/extreme
  }
  if (severity === 'warning') {
    return '#f59e0b'; // Amber for rain/fog
  }
  if (condition.includes('Cloud') || condition.includes('Overcast')) {
    return '#64748b'; // Muted slate-gray for cloudy
  }
  return '#3b82f6'; // Blue for optimal/clear
};

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef>(null);
  const accumulatedBearingRef = useRef<number>(NaN);
  
  // Theme and UI States
  const [theme, setTheme] = useState<'light' | 'dark' | 'night'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as 'light' | 'dark' | 'night') || 'dark';
  });
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
      <div className="flex flex-col gap-4 h-full">
        {/* Input Controls */}
        <div className="flex flex-col gap-2 bg-white/[0.02] p-4 rounded-xl border border-white/5">
          <div className="flex items-center gap-3 bg-[var(--color-dash-surface-hover)] rounded-lg px-3 py-2 border border-white/5 focus-within:border-[var(--color-dash-border)] transition-colors">
            <MapPin size={18} className="text-[var(--color-dash-text-muted)]" />
            <input 
              type="text" 
              value={originInput}
              onChange={e => setOriginInput(e.target.value)}
              className="bg-transparent border-none outline-none text-xs w-full text-[var(--color-dash-text)] placeholder-white/30" 
              placeholder="Origin location..."
            />
          </div>
          
          <div className="flex items-center gap-3 bg-[var(--color-dash-surface-hover)] rounded-lg px-3 py-2 border border-white/5 focus-within:border-[var(--color-dash-border)] transition-colors">
            <Flag size={18} className="text-[var(--color-dash-text-muted)]" />
            <input 
              type="text" 
              value={destInput}
              onChange={e => setDestInput(e.target.value)}
              className="bg-transparent border-none outline-none text-xs w-full text-[var(--color-dash-text)] placeholder-white/30" 
              placeholder="Destination..."
            />
          </div>

          <div className="flex items-center gap-3 bg-[var(--color-dash-surface-hover)] rounded-lg px-3 py-2 border border-white/5 focus-within:border-[var(--color-dash-border)] transition-colors">
            <Clock size={18} className="text-[var(--color-dash-text-muted)]" />
            <select 
              value={departureOffset} 
              onChange={e => setDepartureOffset(Number(e.target.value))}
              className="bg-transparent border-none outline-none text-xs w-full text-[var(--color-dash-text)] cursor-pointer"
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
            className="w-full bg-[var(--color-dash-text)] text-[var(--color-dash-bg)] font-bold py-2 px-4 rounded-lg text-xs hover:opacity-90 transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2 cursor-pointer"
          >
            {isLoading ? (
              <>
                <SpinnerGap size={14} className="animate-spin" />
                Calculating Route...
              </>
            ) : routeState === 'animating' ? 'Plotting Route...' : 'Generate Route'}
          </button>
        </div>

        {/* Route Metrics Summary */}
        {routeData && (
          <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5 flex flex-col gap-3">
            <h3 className="text-dash-label">Journey Metrics</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-white/[0.01] border border-white/5 p-2 rounded-lg">
                <div className="text-[10px] text-[var(--color-dash-text-muted)] font-semibold uppercase tracking-wider">Distance</div>
                <div className="text-sm font-bold text-[var(--color-dash-text)] font-mono mt-1">{Math.round(routeData.totalDistanceMi)} mi</div>
              </div>
              <div className="bg-white/[0.01] border border-white/5 p-2 rounded-lg">
                <div className="text-[10px] text-[var(--color-dash-text-muted)] font-semibold uppercase tracking-wider">ETA</div>
                <div className="text-sm font-bold text-[var(--color-dash-text)] font-mono mt-1">{Math.floor(routeData.totalTimeMins / 60)}h {routeData.totalTimeMins % 60}m</div>
              </div>
              <div className="bg-white/[0.01] border border-white/5 p-2 rounded-lg">
                <div className="text-[10px] text-[var(--color-dash-text-muted)] font-semibold uppercase tracking-wider">Safety Rating</div>
                <div className={`text-sm font-bold font-mono mt-1 ${routeData.overallRisk > 80 ? 'text-[var(--weather-safe)]' : routeData.overallRisk > 50 ? 'text-[var(--weather-warning)]' : 'text-[var(--weather-critical)]'}`}>
                  {routeData.overallRisk}/100
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Checkpoint Timeline */}
        {routeData ? (
          <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-2 min-h-0">
            <h3 className="text-dash-label mb-1">Weather Checkpoints</h3>
            {routeData.segments.map((seg) => {
              const Icon = IconMap[seg.weather.icon] || Sun;
              const isSafe = seg.weather.severity === 'safe';
              const isWarning = seg.weather.severity === 'warning';
              
              const currentDist = progress * routeData.totalDistanceMi;
              const isReached = routeState === 'visible' || currentDist >= seg.distanceFromStartMi;
              const progressPercent = Math.min(100, Math.max(0, (currentDist / seg.distanceFromStartMi) * 100));

              return (
                <div 
                  key={seg.id}
                  onClick={() => setDetailedCheckpoint(seg)}
                  className={`bg-white/[0.02] border border-white/5 p-3 rounded-xl transition-all duration-300 cursor-pointer hover:bg-[var(--color-dash-surface-hover)] flex flex-col gap-2 ${isReached ? 'opacity-100' : 'opacity-40'}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2.5">
                      <div className={`p-1.5 rounded-lg ${isSafe ? 'text-[var(--weather-safe)] bg-[var(--weather-safe-bg)]' : isWarning ? 'text-[var(--weather-warning)] bg-[var(--weather-warning-bg)]' : 'text-[var(--weather-critical)] bg-[var(--weather-critical-bg)]'}`}>
                        <Icon size={14} weight="duotone" />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-bold text-[var(--color-dash-text)] truncate max-w-[190px]">{seg.locationName}</h4>
                        <div className="text-[9px] text-[var(--color-dash-text-muted)] font-mono mt-0.5">
                          {seg.timeFromStartMins === 0 ? 'Departure' : `+${seg.timeFromStartMins}m (${Math.round(seg.distanceFromStartMi)} mi)`}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <div className="text-sm font-bold text-[var(--color-dash-text)] font-mono">{UNIT_CONFIG.formatTemp(seg.weather.temperatureC)}</div>
                      <div className="text-[9px] text-[var(--color-dash-text-muted)] font-semibold uppercase tracking-wider mt-0.5">{seg.weather.condition}</div>
                    </div>
                  </div>

                  {seg.alert && (
                    <div className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-md self-start border
                      ${isWarning 
                        ? 'bg-[var(--weather-warning-bg)] border-[var(--weather-warning)]/20 text-[var(--weather-warning)]' 
                        : 'bg-[var(--weather-critical-bg)] border-[var(--weather-critical)]/20 text-[var(--weather-critical)]'}`}>
                      Alert: {seg.alert}
                    </div>
                  )}

                  {/* Progress bar representing travel position */}
                  <div className="w-full h-[2px] bg-white/5 rounded-full overflow-hidden relative">
                    <div 
                      className="absolute top-0 left-0 h-full bg-white/40 transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 border border-white/5 border-dashed rounded-2xl flex flex-col items-center justify-center p-6 text-center text-[var(--color-dash-text-muted)] my-auto gap-2">
            <MapPin size={24} className="opacity-50" />
            <p className="text-xs max-w-xs font-medium">Enter locations and trigger route mapping to obtain weather intelligence along your path.</p>
          </div>
        )}
      </div>
    );
  };

  const renderFleetTab = () => {
    return (
      <div className="flex flex-col gap-4 h-full">
        <h3 className="text-dash-label mb-1">Fleet Operations</h3>
        <div className="flex flex-col gap-3 overflow-y-auto no-scrollbar flex-1 pb-4">
          {fleet.map((vehicle) => {
            const isSafe = vehicle.risk === 'safe';
            const isWarning = vehicle.risk === 'warning';
            
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
                className="bg-white/[0.02] border border-white/5 hover:bg-[var(--color-dash-surface-hover)] p-4 rounded-xl transition-all duration-150 cursor-pointer flex flex-col gap-3"
              >
                {/* Header */}
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-xs font-bold text-[var(--color-dash-text)] flex items-center gap-1.5">
                      <Truck size={15} />
                      {vehicle.name}
                    </h4>
                    <span className="text-[10px] text-[var(--color-dash-text-muted)]">Driver: {vehicle.driver}</span>
                  </div>
                  <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border
                    ${vehicle.status === 'En Route' 
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                      : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400'}`}>
                    {vehicle.status}
                  </span>
                </div>

                {/* Route detail */}
                <div className="text-[11px] font-semibold text-[var(--color-dash-text-muted)] flex items-center gap-1">
                  <span>{vehicle.origin.split(',')[0]}</span>
                  <span className="opacity-50">→</span>
                  <span>{vehicle.dest.split(',')[0]}</span>
                </div>

                {/* Grid info */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5 text-[10px] text-[var(--color-dash-text-muted)] font-medium">
                  <div>
                    <span className="block text-[8px] uppercase tracking-wider text-[var(--color-dash-text-muted)]/60 mb-0.5">Weather Condition</span>
                    <span className="text-[var(--color-dash-text)] flex items-center gap-1">
                      {vehicle.weather === 'Clear' ? <Sun size={12} /> : vehicle.weather === 'Rain' ? <CloudRain size={12} /> : <Snowflake size={12} />}
                      {vehicle.weather}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[8px] uppercase tracking-wider text-[var(--color-dash-text-muted)]/60 mb-0.5">Route Severity</span>
                    <span className={`font-bold flex items-center gap-1 ${isSafe ? 'text-[var(--weather-safe)]' : isWarning ? 'text-[var(--weather-warning)]' : 'text-[var(--weather-critical)]'}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                      {vehicle.risk.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[8px] uppercase tracking-wider text-[var(--color-dash-text-muted)]/60 mb-0.5">ETA</span>
                    <span className="text-[var(--color-dash-text)]">{vehicle.eta}</span>
                  </div>
                  <div>
                    <span className="block text-[8px] uppercase tracking-wider text-[var(--color-dash-text-muted)]/60 mb-0.5">Remaining Dist</span>
                    <span className="text-[var(--color-dash-text)]">{vehicle.distanceRemaining} mi</span>
                  </div>
                </div>

                {vehicle.status === 'En Route' && (
                  <div className="mt-2 text-center py-1.5 bg-white/5 rounded-lg text-[9px] font-bold text-[var(--color-dash-text)] uppercase tracking-wider hover:bg-white/10 transition-colors">
                    Simulate Journey on Map
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderHistoryTab = () => {
    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="flex justify-between items-center shrink-0">
          <h3 className="text-dash-label">Search History</h3>
          {history.length > 0 && (
            <button 
              onClick={clearHistory}
              className="text-[9px] uppercase tracking-wider font-extrabold text-rose-500/80 hover:text-rose-500 hover:bg-rose-500/10 px-2 py-1 rounded-md transition-all cursor-pointer"
            >
              Clear All
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2.5 overflow-y-auto no-scrollbar flex-1 pb-4">
          {history.length > 0 ? (
            history.map((item) => {
              return (
                <div 
                  key={item.id}
                  onClick={() => {
                    setOriginInput(item.origin);
                    setDestInput(item.dest);
                    calculateRoute(item.origin, item.dest);
                    setActiveTab('route-weather');
                  }}
                  className="bg-white/[0.02] border border-white/5 hover:bg-[var(--color-dash-surface-hover)] p-3 rounded-xl transition-all duration-150 cursor-pointer flex flex-col gap-1.5 relative group"
                >
                  <div className="pr-8">
                    <div className="text-xs font-bold text-[var(--color-dash-text)] flex items-center gap-1.5 truncate">
                      <span>{item.origin.split(',')[0]}</span>
                      <span className="opacity-40">→</span>
                      <span>{item.dest.split(',')[0]}</span>
                    </div>
                    <span className="text-[9px] text-[var(--color-dash-text-muted)] font-mono">{item.timestamp}</span>
                  </div>

                  <div className="flex gap-4 text-[10px] text-[var(--color-dash-text-muted)] font-medium pt-1.5 border-t border-white/5">
                    <span>{item.distance} mi</span>
                    <span className="opacity-30">|</span>
                    <span>{item.duration}</span>
                    <span className="opacity-30">|</span>
                    <span>{item.weatherSummary}</span>
                    <span className="opacity-30">|</span>
                    <span className={item.risk > 80 ? 'text-[var(--weather-safe)]' : item.risk > 50 ? 'text-[var(--weather-warning)]' : 'text-[var(--weather-critical)]'}>
                      {item.risk}/100
                    </span>
                  </div>

                  <button 
                    onClick={(e) => deleteHistoryItem(item.id, e)}
                    className="absolute top-3 right-3 p-1.5 text-[var(--color-dash-text-muted)] hover:text-rose-500 hover:bg-rose-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="Delete Record"
                  >
                    <Trash size={14} />
                  </button>
                </div>
              );
            })
          ) : (
            <div className="border border-white/5 border-dashed rounded-xl flex flex-col items-center justify-center p-6 text-center text-[var(--color-dash-text-muted)] my-auto gap-1">
              <HistoryIcon size={20} className="opacity-50" />
              <p className="text-xs font-semibold">No recent searches</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderAIInsightsTab = () => {
    if (!routeData) {
      return (
        <div className="border border-white/5 border-dashed rounded-xl flex flex-col items-center justify-center p-6 text-center text-[var(--color-dash-text-muted)] my-auto gap-2">
          <Brain size={24} className="opacity-50" />
          <p className="text-xs max-w-xs font-medium">Generate a route to obtain meteorological risk assessments and smart travel recommendations.</p>
        </div>
      );
    }

    // Deterministic intelligence analysis on forecast details
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
      <div className="flex flex-col gap-4 h-full">
        <div className="bg-white/[0.02] border border-white/5 p-4 rounded-xl">
          <h3 className="text-dash-label mb-2">Route Analysis</h3>
          <p className="text-xs leading-relaxed text-[var(--color-dash-text)] font-medium">
            Your trip from {routeData.originName.split(',')[0]} to {routeData.destName.split(',')[0]} spans {Math.round(routeData.totalDistanceMi)} miles and passes through {totalCheckpoints} weather checkpoints.{summaryText}
          </p>
        </div>

        {/* Future Travel Forecast Vertical Timeline */}
        <div className="bg-white/[0.02] border border-white/5 p-4 rounded-xl flex flex-col">
          <h3 className="text-dash-label mb-3">Future Travel Forecast</h3>
          <div className="flex flex-col relative pl-6 border-l border-white/10 ml-2 gap-5 py-2">
            {routeData.segments.map((seg, index) => {
              const Icon = IconMap[seg.weather.icon] || Sun;
              const formattedTime = new Date(seg.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              
              return (
                <div key={seg.id} className="relative flex flex-col">
                  {/* Timeline Dot */}
                  <div className="absolute -left-[30px] top-1.5 w-3 h-3 rounded-full bg-white border border-zinc-955 flex items-center justify-center">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      seg.weather.severity === 'safe' ? 'bg-[var(--weather-safe)]' :
                      seg.weather.severity === 'warning' ? 'bg-[var(--weather-warning)]' : 'bg-[var(--weather-critical)]'
                    }`}></div>
                  </div>
                  
                  {/* Content */}
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="text-[11px] font-bold text-[var(--color-dash-text)] leading-tight">{seg.locationName}</h4>
                      <span className="text-[9px] text-[var(--color-dash-text-muted)] mt-1 block font-mono">
                        {index === 0 ? 'Departure' : `+${seg.timeFromStartMins}m`} • ETA {formattedTime}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Icon size={12} weight="duotone" className="text-[var(--color-dash-text-muted)]" />
                      <span className="text-[10px] font-bold text-[var(--color-dash-text)] font-mono">{UNIT_CONFIG.formatTemp(seg.weather.temperatureC)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actionable Driver Alerts */}
        {warnings.length > 0 && (
          <div className="flex flex-col gap-2 pb-4">
            <h3 className="text-dash-label">Route Hazards & Action Plan</h3>
            {warnings.map((warn, i) => (
              <div 
                key={i} 
                className={`p-3 border rounded-xl flex gap-2.5 
                  ${warn.type === 'critical' 
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' 
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-300'}`}
              >
                <Warning size={16} className="shrink-0 mt-0.5" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider">{warn.title}</span>
                  <p className="text-[10px] leading-relaxed opacity-90">{warn.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={containerRef} className={`relative w-full h-screen overflow-hidden text-text-primary font-sans flex ${theme === 'light' ? 'theme-light' : theme === 'night' ? 'theme-night' : ''} ${isSnapshotMode ? 'bg-transparent pointer-events-none snapshot-mode' : 'bg-bg-base'}`}>
      <style>
        {isSnapshotMode && `
          .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-top-left, .maplibregl-ctrl-top-right {
            display: none !important;
          }
        `}
      </style>

      {/* Floating Map Title */}
      {!isSnapshotMode && routeData && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 md:left-[calc(50%+220px)] pointer-events-none z-20 animate-in fade-in slide-in-from-top-4">
          <div className="dash-glass px-6 py-2 rounded-full shadow-2xl flex items-center gap-2">
            <h1 className="text-dash-label !text-[10px] !tracking-widest !m-0 font-bold">Weather Intelligence Map</h1>
          </div>
        </div>
      )}

      {/* Top right sharing triggers */}
      {!isSnapshotMode && routeData && (
        <div className="absolute top-6 right-6 z-20 flex gap-2 pointer-events-auto">
          <div className="relative">
            <button 
              onClick={() => setShowShareMenu(!showShareMenu)}
              className="dash-glass px-4 py-2 text-xs font-bold flex items-center gap-2 shadow-2xl hover:bg-white/10 transition-colors text-[var(--color-dash-text)] bg-zinc-950/80 border border-white/10 cursor-pointer"
            >
              <ShareNetwork size={14} />
              Share
            </button>

            {showShareMenu && (
              <div className="absolute right-0 mt-2 w-48 dash-glass bg-zinc-950/95 border border-white/10 shadow-2xl rounded-xl py-1 z-30 animate-in fade-in slide-in-from-top-2 duration-150">
                <button 
                  onClick={handleCopyLink}
                  className="w-full px-4 py-2.5 text-xs text-left text-[var(--color-dash-text)] hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Link size={14} />
                  Copy Link
                </button>
                <button 
                  onClick={handleDownloadImage}
                  className="w-full px-4 py-2.5 text-xs text-left text-[var(--color-dash-text)] hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <ImageIcon size={14} />
                  Save Image (PNG)
                </button>
                <button 
                  onClick={handleNativeShare}
                  className="w-full px-4 py-2.5 text-xs text-left text-[var(--color-dash-text)] hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
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
          mapStyle={theme === 'light' ? 'https://tiles.openfreemap.org/styles/positron' : 'https://tiles.openfreemap.org/styles/dark'}
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
                {/* Contrast Underlay */}
                <Layer
                  id={`route-line-${seg.id}`}
                  type="line"
                  paint={{
                    'line-color': '#000000',
                    'line-width': 7,
                    'line-opacity': 0.4
                  }}
                />
                {/* Weather Styled Core Line */}
                <Layer
                  id={`route-line-core-${seg.id}`}
                  type="line"
                  paint={{
                    'line-color': getSegmentColor(seg),
                    'line-width': 3.5,
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
                  <div className="absolute w-8 h-8 bg-white border border-white rounded-full opacity-35 animate-ping"></div>
                  <div 
                    className="w-6 h-6 bg-white border-2 border-zinc-955 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(0,0,0,0.5)]"
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
                    <div className="absolute bottom-full mb-3 -translate-x-1/2 left-1/2 flex flex-col items-center animate-in fade-in zoom-in-95 duration-150 pointer-events-none z-50">
                      <div className="dash-glass px-4 py-2 shadow-2xl text-center rounded-xl whitespace-nowrap bg-zinc-955/90 border border-white/10">
                        <div className="text-[9px] uppercase tracking-widest font-bold mb-0.5 text-[var(--color-dash-text-muted)] truncate max-w-[150px]">{seg.locationName}</div>
                        <div className="text-xl font-bold font-mono text-[var(--color-dash-text)]">{UNIT_CONFIG.formatTemp(seg.weather.temperatureC)}</div>
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
                    className={`flex items-center justify-center transition-transform duration-300
                      ${isHovered && !isSnapshotMode ? 'scale-125' : (!isSnapshotMode ? 'hover:scale-115 cursor-pointer' : '')}
                      animate-in fade-in zoom-in`}
                  >
                    <div className="w-3.5 h-3.5 rounded-full bg-white border-2 border-zinc-950 shadow-[0_0_8px_rgba(0,0,0,0.6)] flex items-center justify-center transition-colors animate-gentle-pulse">
                    </div>
                  </div>
                </div>
              </Marker>
            );
          })}
        </Map>
      </div>

      {/* Unified Sidebar Panel */}
      {!isSnapshotMode && (
        <div 
          className={`absolute top-6 left-6 bottom-6 w-[420px] max-w-[calc(100vw-3rem)] z-10 transition-all duration-300 ease-in-out flex flex-col pointer-events-auto
            ${isSidebarCollapsed ? '-translate-x-[calc(100%+2rem)]' : 'translate-x-0'}`}
        >
          <div className="dash-glass h-full flex flex-col overflow-hidden shadow-2xl relative bg-zinc-955/80 border border-white/10">
            
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--weather-safe)] animate-pulse"></div>
                <span className="font-bold tracking-tight text-[var(--color-dash-text)] text-sm">RouteWeather</span>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Theme Toggle */}
                <button 
                  onClick={() => setTheme(theme === 'dark' ? 'night' : theme === 'night' ? 'light' : 'dark')}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-[var(--color-dash-text-muted)] hover:text-[var(--color-dash-text)] transition-colors cursor-pointer"
                  title={`Theme: ${theme}`}
                >
                  {theme === 'light' ? <Sun size={16} /> : theme === 'dark' ? <Moon size={16} /> : <MoonStars size={16} />}
                </button>
                
                {/* Collapse Button */}
                <button 
                  onClick={() => setIsSidebarCollapsed(true)}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-[var(--color-dash-text-muted)] hover:text-[var(--color-dash-text)] transition-colors cursor-pointer"
                  title="Collapse Sidebar"
                >
                  <CaretLeft size={16} />
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-white/10 shrink-0 bg-white/[0.02]">
              {(['route-weather', 'fleet', 'history', 'ai-insights'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 transition-all cursor-pointer
                    ${activeTab === tab 
                      ? 'border-[var(--color-dash-text)] text-[var(--color-dash-text)] bg-white/[0.02]' 
                      : 'border-transparent text-[var(--color-dash-text-muted)] hover:text-[var(--color-dash-text)] hover:bg-white/[0.01]'}`}
                >
                  {tab === 'route-weather' ? 'Route' : tab === 'ai-insights' ? 'AI Insights' : tab}
                </button>
              ))}
            </div>

            {/* Scrollable Tab Content Area */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-4 flex flex-col gap-4 min-h-0">
              {activeTab === 'route-weather' && renderRouteWeatherTab()}
              {activeTab === 'fleet' && renderFleetTab()}
              {activeTab === 'history' && renderHistoryTab()}
              {activeTab === 'ai-insights' && renderAIInsightsTab()}
            </div>
            
          </div>
        </div>
      )}

      {/* Collapse Trigger */}
      {!isSnapshotMode && isSidebarCollapsed && (
        <button 
          onClick={() => setIsSidebarCollapsed(false)}
          className="absolute top-6 left-6 z-20 w-10 h-10 dash-glass flex items-center justify-center shadow-2xl hover:bg-white/15 transition-all active:scale-95 text-[var(--color-dash-text)] cursor-pointer animate-in fade-in bg-zinc-950/80 border border-white/10"
          title="Expand Sidebar"
        >
          <CaretRight size={18} />
        </button>
      )}

      {/* Detailed Checkpoint Modal */}
      {detailedCheckpoint && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="dash-glass p-6 max-w-md w-full shadow-2xl relative border border-white/10 bg-zinc-950/90 animate-in zoom-in-95 duration-200 flex flex-col gap-4 text-left">
            <button 
              onClick={() => setDetailedCheckpoint(null)}
              className="absolute top-4 right-4 text-[var(--color-dash-text-muted)] hover:text-[var(--color-dash-text)] transition-colors p-1 hover:bg-white/10 rounded-lg cursor-pointer"
            >
              <X size={18} />
            </button>
            
            <div>
              <div className="text-[10px] uppercase font-bold tracking-widest text-[var(--color-dash-text-muted)] mb-1">Weather Station Detail</div>
              <h3 className="text-xl font-bold text-[var(--color-dash-text)] leading-tight">{detailedCheckpoint.locationName}</h3>
              <div className="text-[10px] text-[var(--color-dash-text-muted)] mt-1 font-mono">
                {detailedCheckpoint.coordinates[1].toFixed(4)}°N, {detailedCheckpoint.coordinates[0].toFixed(4)}°E
              </div>
            </div>

            <div className="flex items-center gap-4 py-4 border-y border-white/5">
              <div className="p-3 bg-white/5 rounded-2xl text-[var(--color-dash-text)]">
                {(() => {
                  const Icon = IconMap[detailedCheckpoint.weather.icon] || Sun;
                  return <Icon size={40} weight="duotone" />;
                })()}
              </div>
              <div>
                <div className="text-[2.5rem] font-light leading-none font-mono text-[var(--color-dash-text)]">
                  {UNIT_CONFIG.formatTemp(detailedCheckpoint.weather.temperatureC)}
                </div>
                <div className="text-xs font-medium text-[var(--color-dash-text-muted)] mt-1 flex items-center gap-1.5">
                  <Thermometer size={14} />
                  Feels like {UNIT_CONFIG.formatTemp(detailedCheckpoint.weather.feelsLikeC)}
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-sm font-bold text-[var(--color-dash-text)]">{detailedCheckpoint.weather.condition}</div>
                <div className="text-[10px] text-[var(--color-dash-text-muted)] mt-1">
                  ETA: {new Date(detailedCheckpoint.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-dash-text-muted)] flex items-center gap-1.5">
                  <CloudRain size={12} />
                  Precipitation
                </div>
                <div className="text-xs font-semibold font-mono text-[var(--color-dash-text)]">
                  {detailedCheckpoint.weather.rainProbability}% ({detailedCheckpoint.weather.precipitationIn} in)
                </div>
              </div>
              
              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-dash-text-muted)] flex items-center gap-1.5">
                  <Wind size={12} />
                  Wind
                </div>
                <div className="text-xs font-semibold font-mono text-[var(--color-dash-text)]">
                  {detailedCheckpoint.weather.windSpeedMph} mph {detailedCheckpoint.weather.windDirection}
                </div>
              </div>

              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-dash-text-muted)] flex items-center gap-1.5">
                  <Drop size={12} />
                  Humidity
                </div>
                <div className="text-xs font-semibold font-mono text-[var(--color-dash-text)]">
                  {detailedCheckpoint.weather.humidity}%
                </div>
              </div>

              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-dash-text-muted)] flex items-center gap-1.5">
                  <Eye size={12} />
                  Visibility
                </div>
                <div className="text-xs font-semibold font-mono text-[var(--color-dash-text)]">
                  {detailedCheckpoint.weather.visibilityMi} mi
                </div>
              </div>

              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-dash-text-muted)] flex items-center gap-1.5">
                  <Cloud size={12} />
                  Cloud Cover
                </div>
                <div className="text-xs font-semibold font-mono text-[var(--color-dash-text)]">
                  {detailedCheckpoint.weather.cloudCover}%
                </div>
              </div>

              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-dash-text-muted)] flex items-center gap-1.5">
                  <Info size={12} />
                  UV Index
                </div>
                <div className="text-xs font-semibold font-mono text-[var(--color-dash-text)]">
                  {detailedCheckpoint.weather.uvIndex}
                </div>
              </div>
            </div>

            <div className={`p-4 rounded-xl border flex flex-col gap-1.5 mt-2
              ${detailedCheckpoint.weather.severity === 'safe' 
                ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' 
                : detailedCheckpoint.weather.severity === 'warning'
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
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
