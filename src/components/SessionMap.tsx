import { useEffect, useRef } from 'react';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface SessionMapPoint {
  id: string;
  placeName: string;
  lat: number;
  lon: number;
  orderLabel: string;
}

export interface SessionMapDraftPoint {
  lat: number;
  lon: number;
  label: string;
}

export function SessionMap({
  points,
  selectedPointId,
  onSelectPoint,
  draftPoint,
}: {
  points: SessionMapPoint[];
  selectedPointId: string | null;
  onSelectPoint: (pointId: string) => void;
  draftPoint?: SessionMapDraftPoint | null;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersLayerRef = useRef<LayerGroup | null>(null);
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

      markersLayerRef.current = L.layerGroup().addTo(map);
      map.setView([40.4168, -3.7038], 5);
      mapRef.current = map;
    }

    initializeMap();

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersLayerRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = markersLayerRef.current;
    const L = leafletRef.current;

    if (!map || !layerGroup || !L) {
      return;
    }

    layerGroup.clearLayers();

    if (points.length === 0 && !draftPoint) {
      map.setView([40.4168, -3.7038], 5);
      return;
    }

    const bounds: Array<[number, number]> = [];
    const boundsKey = points
      .map((point) => `${point.id}:${point.lat.toFixed(3)}:${point.lon.toFixed(3)}`)
      .concat(draftPoint ? [`draft:${draftPoint.lat.toFixed(3)}:${draftPoint.lon.toFixed(3)}`] : [])
      .join('|');

    if (points.length > 1) {
      L.polyline(
        points.map((point) => [point.lat, point.lon] as [number, number]),
        {
          color: '#c04f39',
          weight: 2,
          opacity: 0.95,
          dashArray: '8 6',
        },
      ).addTo(layerGroup);
    }

    for (const point of points) {
      const latLng: [number, number] = [point.lat, point.lon];
      const isSelected = point.id === selectedPointId;

      bounds.push(latLng);

      const marker = L.marker(latLng, {
        icon: L.divIcon({
          className: 'session-map-marker-shell',
          html: `<div class="session-map-marker${isSelected ? ' is-selected' : ''}">${point.orderLabel}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      });

      marker.bindTooltip(`${point.orderLabel} · ${point.placeName}`, {
        direction: 'top',
        offset: [0, -8],
        opacity: 0.92,
      });
      marker.on('click', () => onSelectPoint(point.id));
      marker.addTo(layerGroup);
    }

    if (draftPoint) {
      const latLng: [number, number] = [draftPoint.lat, draftPoint.lon];
      bounds.push(latLng);

      const draftMarker = L.circleMarker(latLng, {
        radius: 10,
        color: '#151515',
        weight: 2,
        dashArray: '5 4',
        fillColor: '#c04f39',
        fillOpacity: 0.55,
      });

      draftMarker.bindTooltip(`Nuevo · ${draftPoint.label}`, {
        direction: 'top',
        offset: [0, -8],
        opacity: 0.92,
      });
      draftMarker.addTo(layerGroup);
    }

    if (boundsKey !== fittedBoundsKeyRef.current) {
      fittedBoundsKeyRef.current = boundsKey;
      if (bounds.length === 1) {
        map.setView(bounds[0], 13);
      } else {
        map.fitBounds(bounds, { padding: [36, 36] });
      }
    }

    window.requestAnimationFrame(() => {
      map.invalidateSize();
    });
  }, [draftPoint, onSelectPoint, points, selectedPointId]);

  return <div ref={mapContainerRef} className="field-map" aria-label="Mapa de puntos de la sesión" />;
}
