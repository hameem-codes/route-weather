import {
  MapPin,
  Flag,
  Sun,
  Cloud,
  CloudRain,
  CloudLightning,
  Snowflake,
  CloudSnow
} from '@phosphor-icons/react'
import * as maplibregl from 'maplibre-gl';
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre';
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

const geojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: routeSegments.map(s => s.coordinates)
      }
    }
  ]
};

function App() {
  return (
    <div className="relative w-full h-screen bg-zinc-950 overflow-hidden text-zinc-50 font-sans flex">
      {/* Interactive Map */}
      <div className="absolute inset-0 z-0">
        <Map
          mapLib={maplibregl}
          initialViewState={{
            longitude: -121.3,
            latitude: 38.5,
            zoom: 7.5,
            pitch: 45
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        >
          {/* Glowing Route Line */}
          <Source id="route" type="geojson" data={geojson as any}>
            <Layer
              id="route-line"
              type="line"
              paint={{
                'line-color': '#a855f7', // Glowing purple to match reference
                'line-width': 6,
                'line-opacity': 0.8,
                'line-blur': 2
              }}
            />
            <Layer
              id="route-line-core"
              type="line"
              paint={{
                'line-color': '#d8b4fe',
                'line-width': 2,
              }}
            />
          </Source>

          {/* Markers for Weather Points */}
          {routeSegments.map(seg => {
            const isSafe = seg.weather.severity === 'safe';
            const isWarning = seg.weather.severity === 'warning';
            
            return (
              <Marker
                key={`marker-${seg.id}`}
                longitude={seg.coordinates[0]}
                latitude={seg.coordinates[1]}
                anchor="bottom"
              >
                <div className={`flex flex-col items-center justify-center -translate-y-2 cursor-pointer transition-transform hover:scale-110
                  ${isSafe ? 'text-blue-400' : isWarning ? 'text-amber-400' : 'text-fuchsia-400'}`}
                >
                  <div className="bg-zinc-900/80 backdrop-blur-sm border border-zinc-700/50 rounded-lg p-1 shadow-lg flex items-center justify-center mb-1">
                     <seg.weather.icon size={20} weight="duotone" />
                  </div>
                  <div className="w-1.5 h-1.5 rounded-full bg-current shadow-[0_0_10px_currentColor]"></div>
                </div>
              </Marker>
            );
          })}
        </Map>
      </div>

      {/* Sidebar Dashboard (Layered on top of map) */}
      <div className="absolute top-0 left-0 w-full md:w-[400px] h-full flex flex-col p-4 md:p-6 z-10 pointer-events-none">
        
        {/* Input Panel */}
        <div className="pointer-events-auto bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-2xl p-5 mb-4 shadow-2xl flex-shrink-0">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 bg-zinc-800/50 rounded-xl px-4 py-3 border border-transparent focus-within:border-zinc-700 transition-colors">
              <MapPin size={20} className="text-zinc-400" />
              <input type="text" defaultValue="San Francisco, CA" className="bg-transparent border-none outline-none text-sm w-full font-medium" />
            </div>
            <div className="w-[1px] h-3 bg-zinc-700 ml-6"></div>
            <div className="flex items-center gap-3 bg-zinc-800/50 rounded-xl px-4 py-3 border border-transparent focus-within:border-zinc-700 transition-colors">
              <Flag size={20} className="text-zinc-400" />
              <input type="text" defaultValue="Lake Tahoe, CA" className="bg-transparent border-none outline-none text-sm w-full font-medium" />
            </div>
          </div>
          
          <div className="mt-5 pt-4 border-t border-zinc-800 flex justify-between items-end">
            <div>
              <div className="text-3xl font-bold tracking-tight">4h 15m</div>
              <div className="text-sm text-zinc-400 font-mono mt-1">210 mi • ETA 8:30 PM</div>
            </div>
            <button className="bg-zinc-100 text-zinc-900 font-medium px-4 py-2 rounded-full text-sm hover:bg-white transition-colors active:scale-95 cursor-pointer">
              Leave Now
            </button>
          </div>
        </div>

        {/* Timeline (Scrollable) */}
        <div className="pointer-events-auto flex-1 overflow-y-auto no-scrollbar bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-2xl p-5 shadow-2xl">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500 mb-6 px-2">Weather Route</h2>
          
          <div className="relative pl-6">
            {/* Connecting line */}
            <div className="absolute top-4 bottom-4 left-[11px] w-[2px] bg-zinc-800 rounded-full"></div>
            
            <div className="flex flex-col gap-8">
              {routeSegments.map((seg) => {
                const Icon = seg.weather.icon;
                const isSafe = seg.weather.severity === 'safe';
                const isWarning = seg.weather.severity === 'warning';
                
                return (
                  <div key={seg.id} className="relative">
                    {/* Node */}
                    <div className={`absolute -left-6 w-3 h-3 rounded-full border-2 border-zinc-900 mt-1.5 z-10 
                      ${isSafe ? 'bg-blue-500' : isWarning ? 'bg-amber-500' : 'bg-fuchsia-500'}`}>
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-baseline">
                        <h3 className="font-medium text-zinc-100">{seg.locationName}</h3>
                        <span className="text-xs font-mono text-zinc-500">+{seg.timeFromStartMins}m</span>
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
