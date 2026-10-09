import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import PageHeader from "@/components/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_LABEL = {
  "": "Wszystkie",
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

export default function Orders() {
  const { current } = useLocation();
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!current) return;
    const load = async () => {
      const params = { location_id: current.id };
      if (status) params.status = status;
      const { data } = await api.get("/orders", { params });
      setOrders(data);
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [current, status]);

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        eyebrow="Operacje"
        title="Zamówienia"
        description={`${orders.length} pozycji · ${current?.name}`}
        actions={
          <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[180px] bg-transparent border-border" data-testid="filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie</SelectItem>
              {Object.entries(STATUS_LABEL).filter(([k]) => k !== "").map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="border border-border bg-[#12151c] rounded-lg overflow-hidden">
        <div className="grid grid-cols-[80px_1fr_120px_120px_140px_120px] text-[11px] uppercase tracking-[0.14em] text-muted-foreground px-5 py-3 border-b border-border">
          <div>Numer</div>
          <div>Pozycje</div>
          <div>Typ</div>
          <div>Status</div>
          <div>Data</div>
          <div className="text-right">Kwota</div>
        </div>
        {orders.length === 0 && (
          <div className="p-10 text-center text-sm text-muted-foreground">Brak zamówień dla wybranego filtra.</div>
        )}
        {orders.map((o) => (
          <Link
            to={`/orders/${o.id}`}
            key={o.id}
            className="grid grid-cols-[80px_1fr_120px_120px_140px_120px] px-5 py-3 text-sm border-b border-border/50 hover:bg-white/5 transition-colors items-center"
            data-testid={`order-row-${o.number}`}
          >
            <div className="font-mono text-blue-400">#{o.number}</div>
            <div className="truncate">
              {o.items.slice(0, 2).map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}
              {o.items.length > 2 && ` · +${o.items.length - 2}`}
            </div>
            <div className="text-xs text-muted-foreground">{o.order_type}</div>
            <div>
              <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLOR[o.status]}`}>
                {STATUS_LABEL[o.status]}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(o.created_at).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}
            </div>
            <div className="text-right font-mono">{o.totals?.gross?.toFixed(2)} zł</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
