import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { CircleDollarSign, ShoppingBag, Clock, TrendingUp, ArrowRight } from "lucide-react";
import api from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import PageHeader from "@/components/PageHeader";

const STATUS_LABEL = {
  new: "Nowe",
  in_progress: "W trakcie",
  ready: "Gotowe",
  in_delivery: "W dostawie",
  completed: "Zrealizowane",
  cancelled: "Anulowane",
};

const STATUS_COLOR = {
  new: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  in_progress: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  ready: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  in_delivery: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  completed: "bg-neutral-500/20 text-neutral-300 border-neutral-500/30",
  cancelled: "bg-red-500/20 text-red-300 border-red-500/30",
};

export default function Dashboard() {
  const { current } = useLocation();
  const [data, setData] = useState(null);
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    const load = async () => {
      const params = current ? { location_id: current.id } : {};
      const [a, o] = await Promise.all([
        api.get("/analytics/dashboard", { params }),
        api.get("/orders", { params: { ...params, limit: 8 } }),
      ]);
      setData(a.data);
      setOrders(o.data);
    };
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, [current]);

  const kpis = [
    { label: "Przychód dzisiaj", value: `${(data?.revenue_today || 0).toFixed(2)} zł`, icon: CircleDollarSign, color: "text-emerald-400" },
    { label: "Zamówienia dzisiaj", value: data?.orders_today || 0, icon: ShoppingBag, color: "text-blue-400" },
    { label: "Aktywne zamówienia", value: data?.active_orders || 0, icon: Clock, color: "text-amber-400" },
    { label: "Śr. wartość zamówienia", value: `${(data?.avg_ticket || 0).toFixed(2)} zł`, icon: TrendingUp, color: "text-purple-400" },
  ];

  return (
    <div className="p-8 space-y-8">
      <PageHeader
        eyebrow="Panel"
        title="Dashboard"
        description={`Przegląd operacyjny – ${current?.name || "wybierz lokal"}`}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="border border-border bg-[#12151c] rounded-lg p-5 hover:border-border transition-colors"
            data-testid={`kpi-${k.label}`}
          >
            <div className="flex items-start justify-between">
              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{k.label}</div>
              <k.icon size={18} className={k.color} />
            </div>
            <div className="font-display text-3xl font-semibold mt-3 tracking-tight">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 border border-border bg-[#12151c] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Przychód</div>
              <div className="font-display text-xl font-semibold">Ostatnie 7 dni</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data?.chart_7d || []}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#272a35" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#6b7280" fontSize={11} />
              <YAxis stroke="#6b7280" fontSize={11} />
              <Tooltip
                contentStyle={{ background: "#12151c", border: "1px solid #272a35", borderRadius: 6 }}
                labelStyle={{ color: "#9ca3af" }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="url(#g1)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border bg-[#12151c] rounded-lg p-5">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground mb-1">Statusy</div>
          <div className="font-display text-xl font-semibold mb-4">Dzisiaj</div>
          <div className="space-y-2">
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                <span className="text-sm text-muted-foreground">{v}</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLOR[k]}`}>
                  {data?.status_breakdown?.[k] || 0}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border border-border bg-[#12151c] rounded-lg">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Ostatnie</div>
            <div className="font-display text-xl font-semibold">Zamówienia</div>
          </div>
          <Link to="/orders" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            Wszystkie <ArrowRight size={12} />
          </Link>
        </div>
        <div className="divide-y divide-border/60">
          {orders.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">Brak zamówień.</div>
          )}
          {orders.map((o) => (
            <Link
              to={`/orders/${o.id}`}
              key={o.id}
              className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
              data-testid={`dashboard-order-${o.number}`}
            >
              <div className="flex items-center gap-4">
                <div className="font-mono text-sm text-blue-400">#{o.number}</div>
                <div>
                  <div className="text-sm font-medium">
                    {o.items.length} poz. · {o.order_type}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {o.customer_name || o.created_by_name}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLOR[o.status]}`}>
                  {STATUS_LABEL[o.status]}
                </span>
                <span className="font-mono text-sm">{o.totals?.gross?.toFixed(2)} zł</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
