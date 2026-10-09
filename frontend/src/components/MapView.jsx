import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const pin = (color, pulse) =>
  L.divIcon({
    className: "",
    html: `<span style="position:relative;display:block;width:18px;height:18px;">
      <span style="position:absolute;inset:0;border-radius:9999px;background:${color};border:2px solid #0a0c10;box-shadow:0 0 0 2px ${color}55;"></span>
      ${pulse ? `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${color};opacity:.25;animation:mapPulse 1.6s ease-out infinite;"></span>` : ""}
    </span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

export default function MapView({ markers = [], center = [52.11, 19.42], zoom = 6, className = "" }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: false }).setView(center, zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = [];
    markers.forEach((m) => {
      if (m.lat == null || m.lng == null) return;
      const mk = L.marker([m.lat, m.lng], { icon: pin(m.color || "#3b82f6", m.pulse) });
      if (m.label) mk.bindPopup(`<b>${m.label}</b>${m.sub ? `<br/><span style="color:#64748b">${m.sub}</span>` : ""}`);
      mk.addTo(layer);
      pts.push([m.lat, m.lng]);
    });
    if (pts.length === 1) map.setView(pts[0], 14);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25));
  }, [markers]);

  return <div ref={elRef} className={className} data-testid="map-view" />;
}
