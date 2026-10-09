import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Navigation, PackageCheck, Truck, Phone, LogOut, RefreshCw, MapPin, Delete, Route } from "lucide-react";
import { API } from "@/lib/api";
import MapView from "@/components/MapView";

const money = (v) => `${Number(v || 0).toFixed(2)} zł`;
const tokenKey = (slug) => `ig_courier_${slug}`;

function haversine(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

function optimizeRoute(list, origin) {
  const withGeo = list.filter((o) => o.geo), without = list.filter((o) => !o.geo);
  const remaining = [...withGeo], ordered = [];
  let cur = origin;
  while (remaining.length) {
    let bi = 0, bd = Infinity;
    remaining.forEach((o, i) => { const d = haversine(cur, o.geo); if (d < bd) { bd = d; bi = i; } });
    const [next] = remaining.splice(bi, 1);
    ordered.push({ ...next, _dist: bd });
    cur = next.geo;
  }
  return [...ordered, ...without];
}

export default function CourierPortal() {
  const { slug } = useParams();
  const [tenant, setTenant] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey(slug)) || "");
  const [name, setName] = useState(localStorage.getItem(`${tokenKey(slug)}_name`) || "");
  const [pin, setPin] = useState("");
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [myPos, setMyPos] = useState(null);
  const [optimize, setOptimize] = useState(true);
  const lastSent = useRef(0);

  const authAxios = useCallback(() => axios.create({ baseURL: API, headers: { Authorization: `Bearer ${token}` } }), [token]);

  // Live GPS: watch position, push to backend every ~15s
  useEffect(() => {
    if (!token || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMyPos(pos);
        const now = Date.now();
        if (now - lastSent.current > 15000) {
          lastSent.current = now;
          authAxios().post("/courier/location", pos).catch(() => {});
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [token, authAxios]);

  useEffect(() => {
    axios.get(`${API}/public/tenant/${slug}`).then((r) => setTenant(r.data)).catch(() => setTenant(null));
  }, [slug]);

  const loadDeliveries = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const { data } = await authAxios().get("/courier/deliveries");
      setDeliveries(data);
    } catch (e) {
      if (e?.response?.status === 401) { logout(); }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, authAxios]);

  useEffect(() => {
    if (!token) return;
    loadDeliveries();
    const t = setInterval(loadDeliveries, 12000);
    return () => clearInterval(t);
  }, [token, loadDeliveries]);

  const login = async () => {
    if (pin.length < 4) return toast.error("PIN ma min. 4 cyfry");
    try {
      const { data } = await axios.post(`${API}/auth/pin-login`, { tenant_id: tenant.id, pin });
      if (data.employee?.role !== "courier") {
        return toast.error("Ten PIN nie należy do kuriera");
      }
      localStorage.setItem(tokenKey(slug), data.token);
      localStorage.setItem(`${tokenKey(slug)}_name`, data.employee.name);
      setName(data.employee.name);
      setToken(data.token);
      setPin("");
    } catch {
      toast.error("Nieprawidłowy PIN");
    }
  };

  const logout = () => {
    localStorage.removeItem(tokenKey(slug));
    localStorage.removeItem(`${tokenKey(slug)}_name`);
    setToken(""); setName(""); setDeliveries([]);
  };

  const navigateTo = (addr) => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr || "")}`, "_blank");

  const depart = async (o) => {
    setBusyId(o.id);
    try {
      const { data } = await authAxios().post(`/courier/deliveries/${o.id}/depart`);
      if (data.sms?.sent) toast.success(`Wyjazd zarejestrowany · SMS wysłany do klienta`);
      else toast.success("Wyjazd zarejestrowany");
      loadDeliveries();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Błąd");
    } finally { setBusyId(null); }
  };

  const delivered = async (o) => {
    setBusyId(o.id);
    try {
      await authAxios().post(`/courier/deliveries/${o.id}/delivered`);
      toast.success(`Zamówienie #${o.number} dostarczone`);
      loadDeliveries();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Błąd");
    } finally { setBusyId(null); }
  };

  if (tenant === null) {
    return <div className="min-h-screen bg-[#0a0c10] grid place-items-center text-sm text-muted-foreground">Ładowanie…</div>;
  }
  if (tenant === false || !tenant.id) {
    return <div className="min-h-screen bg-[#0a0c10] grid place-items-center text-sm text-muted-foreground">Nie znaleziono restauracji.</div>;
  }

  // Login screen
  if (!token) {
    return (
      <div className="min-h-screen bg-[#0a0c10] text-foreground flex flex-col items-center justify-center p-6" data-testid="courier-login">
        <div className="w-full max-w-xs">
          <div className="flex items-center gap-2 justify-center mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center"><Truck size={20} className="text-white" /></div>
            <div className="text-left"><div className="font-display font-semibold">Kurier</div><div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{tenant.name}</div></div>
          </div>
          <p className="text-center text-sm text-muted-foreground mb-4">Zaloguj się PIN-em kuriera</p>
          <div className="flex justify-center gap-2 mb-6" data-testid="courier-pin-display">
            {Array.from({ length: 6 }).map((_, i) => (<div key={i} className={`w-3.5 h-3.5 rounded-full ${i < pin.length ? "bg-amber-400" : "bg-white/10"}`} />))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} onClick={() => setPin((p) => (p.length >= 6 ? p : p + d))} className="h-16 rounded-xl border border-border bg-[#12151c] text-xl font-mono active:bg-white/10" data-testid={`courier-key-${d}`}>{d}</button>
            ))}
            <button onClick={() => setPin("")} className="h-16 rounded-xl border border-border text-muted-foreground active:bg-white/10 text-sm" data-testid="courier-key-clear">C</button>
            <button onClick={() => setPin((p) => (p.length >= 6 ? p : p + "0"))} className="h-16 rounded-xl border border-border bg-[#12151c] text-xl font-mono active:bg-white/10" data-testid="courier-key-0">0</button>
            <button onClick={() => setPin((p) => p.slice(0, -1))} className="h-16 rounded-xl border border-border text-muted-foreground active:bg-white/10"><Delete size={18} className="mx-auto" /></button>
          </div>
          <button onClick={login} className="w-full mt-6 h-12 rounded-xl bg-amber-500 hover:bg-amber-400 font-medium text-black" data-testid="courier-login-btn">Zaloguj</button>
        </div>
      </div>
    );
  }

  // Deliveries screen
  const ordered = optimize && myPos ? optimizeRoute(deliveries, myPos) : deliveries;
  return (
    <div className="min-h-screen bg-[#0a0c10] text-foreground" data-testid="courier-app">
      <header className="sticky top-0 z-10 bg-[#12151c]/95 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center"><Truck size={16} className="text-white" /></div>
          <div><div className="text-sm font-medium">{name}</div><div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{tenant.name}</div></div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={loadDeliveries} className="p-2 rounded-md hover:bg-white/5" data-testid="courier-refresh"><RefreshCw size={16} className={loading ? "animate-spin text-amber-400" : "text-muted-foreground"} /></button>
          <button onClick={logout} className="p-2 rounded-md hover:bg-white/5 text-muted-foreground" data-testid="courier-logout"><LogOut size={16} /></button>
        </div>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto pb-10">
        <MapView
          className="h-52 w-full rounded-xl border border-border"
          markers={[
            ...(myPos ? [{ ...myPos, color: "#3b82f6", pulse: true, label: "Twoja pozycja" }] : []),
            ...deliveries.filter((o) => o.geo).map((o) => ({
              ...o.geo, color: o.status === "in_delivery" ? "#a855f7" : "#10b981",
              label: `#${o.number} · ${o.customer_name}`, sub: o.customer_address,
            })),
          ]}
          center={myPos ? [myPos.lat, myPos.lng] : [52.11, 19.42]}
          zoom={myPos ? 13 : 6}
        />

        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Dostawy ({deliveries.length})</div>
          <button onClick={() => setOptimize((v) => !v)} data-testid="courier-optimize"
            className={`text-xs px-3 py-1.5 rounded-full border flex items-center gap-1.5 transition-colors ${optimize ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-border text-muted-foreground"}`}>
            <Route size={13} /> Optymalizuj trasę
          </button>
        </div>
        {!myPos && <div className="text-[11px] text-muted-foreground -mt-1">Włącz lokalizację w przeglądarce, aby zobaczyć trasę i kolejność.</div>}

        {deliveries.length === 0 && (
          <div className="text-center py-16 text-sm text-muted-foreground" data-testid="courier-empty">
            <PackageCheck size={32} className="mx-auto mb-3 opacity-40" />
            Brak dostaw w kolejce.
          </div>
        )}
        {ordered.map((o, idx) => (
          <div key={o.id} className="border border-border bg-[#12151c] rounded-xl p-4 space-y-3" data-testid={`courier-order-${o.number}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {optimize && myPos && o.geo && <span className="w-6 h-6 rounded-full bg-amber-500 text-black text-xs font-bold grid place-items-center shrink-0">{idx + 1}</span>}
                <div>
                  <div className="font-display text-lg font-semibold">#{o.number}</div>
                  <div className="text-sm">{o.customer_name}</div>
                </div>
              </div>
              <span className={`text-[11px] px-2 py-1 rounded-full border ${o.status === "in_delivery" ? "bg-purple-500/15 text-purple-300 border-purple-500/30" : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"}`}>
                {o.status === "in_delivery" ? "W drodze" : "Do odbioru"}
              </span>
            </div>
            <div className="flex items-start gap-2 text-sm text-muted-foreground"><MapPin size={15} className="mt-0.5 shrink-0 text-amber-400" />{o.customer_address || "Brak adresu"}{o._dist != null && <span className="ml-auto text-xs text-amber-300 whitespace-nowrap">{o._dist.toFixed(1)} km</span>}</div>
            <div className="text-xs text-muted-foreground">{o.item_count} poz. · {money(o.totals?.gross)} · {o.payment_status === "paid" ? "opłacone" : "płatność u klienta"}</div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => navigateTo(o.customer_address)} className="h-11 rounded-lg border border-border bg-transparent flex items-center justify-center gap-2 text-sm active:bg-white/5" data-testid={`courier-nav-${o.number}`}><Navigation size={15} className="text-blue-400" /> Nawiguj</button>
              {o.customer_phone ? (
                <a href={`tel:${o.customer_phone}`} className="h-11 rounded-lg border border-border bg-transparent flex items-center justify-center gap-2 text-sm active:bg-white/5"><Phone size={15} className="text-emerald-400" /> Zadzwoń</a>
              ) : <div />}
            </div>
            {o.status === "ready" ? (
              <button disabled={busyId === o.id} onClick={() => depart(o)} className="w-full h-12 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-medium flex items-center justify-center gap-2 disabled:opacity-50" data-testid={`courier-depart-${o.number}`}>
                <Truck size={16} /> Wyruszam w trasę
              </button>
            ) : (
              <button disabled={busyId === o.id} onClick={() => delivered(o)} className="w-full h-12 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-medium flex items-center justify-center gap-2 disabled:opacity-50" data-testid={`courier-delivered-${o.number}`}>
                <PackageCheck size={16} /> Dostarczone
              </button>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}
