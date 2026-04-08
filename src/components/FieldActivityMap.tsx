import { useEffect, useRef } from 'react';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface FieldActivityCluster {
  id: string;
  lat: number;
  lon: number;
  count: number;
  label: string;
}

export interface FieldActivityLocation {
  lat: number;
  lon: number;
  label: string;
}

export function FieldActivityMap({
  clusters,
  currentLocation,
}: {
  clusters: FieldActivityCluster[];
  currentLocation?: FieldActivityLocation | null;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const fittedBoundsKeyRef = useRef<string>('');

  useEffect(() => {
    let active = true;

    async function initializeMap() {
      if (!mapContainerRef.current || mapRef.current) {
        return;
      }

      const L = await import('leaflet');
      if (!active || !mapContainerRef.current) {
        return;
      }

      leafletRef.current = L;

      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      layerRef.current = L.layerGroup().addTo(map);
      map.setView([40.4168, -3.7038], 4);
      mapRef.current = map;
    }

    initializeMap();

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      layerRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const L = leafletRef.current;

    if (!map || !layer || !L) {
      return;
    }

    layer.clearLayers();

    const bounds: Array<[number, number]> = [];
    const boundsKey = clusters
      .map((cluster) => `${cluster.id}:${cluster.lat.toFixed(2)}:${cluster.lon.toFixed(2)}:${cluster.count}`)
      .concat(
        currentLocation ? [`current:${currentLocation.lat.toFixed(2)}:${currentLocation.lon.toFixed(2)}`] : [],
      )
      .join('|');

    for (const cluster of clusters) {
      const latLng: [number, number] = [cluster.lat, cluster.lon];
      bounds.push(latLng);

      const radius = Math.min(26, 10 + cluster.count * 2.5);
      const circle = L.circleMarker(latLng, {
        radius,
        weight: 1,
        color: 'rgba(143, 206, 255, 0.88)',
        fillColor: 'rgba(31, 128, 255, 0.38)',
        fillOpacity: 0.78,
      });

      circle.bindTooltip(`${cluster.label} · ${cluster.count} registros`, {
        direction: 'top',
        offset: [0, -6],
        opacity: 0.95,
      });
      circle.addTo(layer);
    }

    if (currentLocation) {
      const latLng: [number, number] = [currentLocation.lat, currentLocation.lon];
      bounds.push(latLng);

      const pulse = L.circleMarker(latLng, {
        radius: 11,
        weight: 2,
        color: 'rgba(207, 237, 255, 0.96)',
        fillColor: 'rgba(56, 159, 255, 0.98)',
        fillOpacity: 1,
      });

      pulse.bindTooltip(currentLocation.label, {
        direction: 'top',
        offset: [0, -8],
        opacity: 0.95,
      });
      pulse.addTo(layer);
    }

    if (boundsKey !== fittedBoundsKeyRef.current) {
      fittedBoundsKeyRef.current = boundsKey;
      if (bounds.length === 0) {
        map.setView([40.4168, -3.7038], 4);
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 9);
      } else {
        map.fitBounds(bounds, { padding: [32, 32] });
      }
    }

    window.requestAnimationFrame(() => {
      map.invalidateSize();
    });
  }, [clusters, currentLocation]);

  return <div ref={mapContainerRef} className="field-map field-map--dashboard" aria-label="Mapa de actividad de grabaciones" />;
}
