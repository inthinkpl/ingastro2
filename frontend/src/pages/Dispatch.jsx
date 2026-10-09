import { useEffect, useState, useCallback } from "react";
import { Truck, MapPin, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import PageHeader from "@/components/PageHeader";
import MapView from "@/components/MapView";

const money = (v) => `${Number(v || 0).toFixed(2)} zł`;

export default function Dispatch() {
  const { current } = useLocation();
  const [couriers, setCouriers] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, d] = await Promise.all([
        api.get("/courier/locations"),
        api.get("/courier/deliveries", { params: current ? { location_id: current.id } : {} }),
      ]);
      setCouriers(c.data);
      setDeliveries(d.data);
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const markers = [
    ...couriers.filter((c) => c.lat != null).map((c) => ({
      lat: c.lat, lng: c.lng, color: c.online ? "#3b82f6" : "#64748b", pulse: c.online,
      label: `🚚 ${c.name}`, sub: c.online ? "Online" : "Offline",
    })),
    ...deliveries.filter((o) => o.geo).map((o) => ({
      ...o.geo, color: o.status === "in_delivery" ? "#a855f7" : "#10b981",
      label: `#${o.number} · ${o.customer_name}`, sub: o.customer_address,
    })),
  ];
  const onlineCount = couriers.filter((c) => c.online).length;

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        eyebrow="Logistyka"
        title="Dyspozytornia"
        description="Pozycje kurierów na żywo i aktywne dostawy na mapie."
        actions={
          <button onClick={load} className="p-2 rounded-md border border-border hover:bg-white/5" data-testid="dispatch-refresh">
            <RefreshCw size={16} className={loading ? "animate-spin text-blue-400" : "text-muted-foreground"} />
          </button>
        }
      />

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <MapView markers={markers} className="h-[560px] w-full rounded-xl border border-border" data-testid="dispatch-map" />

        <div className="space-y-6">
          <section className="border border-border bg-[#12151c] rounded-lg p-5" data-testid="dispatch-couriers">
            <h2 className="font-display font-semibold flex items-center gap-2 mb-3"><Truck size={16} className="text-blue-400" /> Kurierzy <span className="text-sm text-muted-foreground font-normal">({onlineCount} online)</span></h2>
            {couriers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Brak zarejestrowanych pozycji kurierów.</p>
            ) : couriers.map((c) => (
              <div key={c.employee_id} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0" data-testid={`dispatch-courier-${c.employee_id}`}>
                <span className={`w-2 h-2 rounded-full ${c.online ? "bg-blue-400 animate-pulse" : "bg-muted-foreground/40"}`} />
                <div className="flex-1"><div className="text-sm font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.online ? "Online" : "Offline"} · {new Date(c.at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}</div></div>
              </div>
            ))}
          </section>

          <section className="border border-border bg-[#12151c] rounded-lg p-5" data-testid="dispatch-deliveries">
            <h2 className="font-display font-semibold flex items-center gap-2 mb-3"><MapPin size={16} className="text-amber-400" /> Aktywne dostawy <span className="text-sm text-muted-foreground font-normal">({deliveries.length})</span></h2>
            {deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Brak dostaw w realizacji.</p>
            ) : deliveries.map((o) => (
              <div key={o.id} className="flex items-start gap-3 py-2 border-b border-border/40 last:border-0" data-testid={`dispatch-delivery-${o.number}`}>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border mt-0.5 ${o.status === "in_delivery" ? "bg-purple-500/15 text-purple-300 border-purple-500/30" : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"}`}>{o.status === "in_delivery" ? "W drodze" : "Gotowe"}</span>
                <div className="flex-1"><div className="text-sm font-medium">#{o.number} · {o.customer_name}</div><div className="text-xs text-muted-foreground">{o.customer_address || "Brak adresu"} · {money(o.totals?.gross)}</div></div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
