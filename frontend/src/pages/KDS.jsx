import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Flame, Check, X, Clock } from "lucide-react";
import api, { BACKEND_URL } from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import { Button } from "@/components/ui/button";

function elapsedMinutes(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function slaColor(min) {
  if (min < 10) return { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-300", chip: "bg-emerald-500/80" };
  if (min < 20) return { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-300", chip: "bg-amber-500/80" };
  return { bg: "bg-red-500/15", border: "border-red-500/50", text: "text-red-300", chip: "bg-red-500/80 pulse-danger" };
}

export default function KDS() {
  const { current } = useLocation();
  const [orders, setOrders] = useState([]);
  const [, forceTick] = useState(0);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!current) return;
    const load = async () => {
      const { data } = await api.get("/orders", {
        params: { location_id: current.id, limit: 200 },
      });
      setOrders(data.filter((o) => ["new", "in_progress"].includes(o.status)));
    };
    load();

    // WebSocket
    const token = localStorage.getItem("ig_token");
    const wsUrl = `${BACKEND_URL.replace("http", "ws")}/api/ws/kds?token=${encodeURIComponent(
      token
    )}&location_id=${current.id}`;
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === "order.created") {
            setOrders((o) => [msg.order, ...o]);
            toast.info(`Nowe zamówienie #${msg.order.number}`);
          } else if (msg.event === "order.status") {
            setOrders((o) => {
              if (["new", "in_progress"].includes(msg.order.status)) {
                const exists = o.find((x) => x.id === msg.order.id);
                if (exists) return o.map((x) => (x.id === msg.order.id ? msg.order : x));
                return [msg.order, ...o];
              }
              return o.filter((x) => x.id !== msg.order.id);
            });
          }
        } catch {}
      };
    } catch (e) {
      console.warn("WS error", e);
    }

    const t = setInterval(() => forceTick((x) => x + 1), 10000);
    return () => {
      clearInterval(t);
      wsRef.current?.close();
    };
  }, [current]);

  const updateStatus = async (o, status) => {
    try {
      const { data } = await api.put(`/orders/${o.id}/status`, { status });
      setOrders((list) => {
        if (["new", "in_progress"].includes(data.status)) {
          return list.map((x) => (x.id === data.id ? data : x));
        }
        return list.filter((x) => x.id !== data.id);
      });
      toast.success("Status zaktualizowany");
    } catch (e) {
      toast.error("Nie można zmienić statusu");
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-blue-400 mb-1">Kuchnia</div>
          <h1 className="font-display text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Flame size={24} className="text-amber-400" /> Kitchen Display System
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {current?.name} · {orders.length} aktywnych bonów · live
          </p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-16 text-center">
          <Flame size={32} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Brak aktywnych bonów. Czekamy na pierwsze zamówienie…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {orders.map((o) => {
            const min = elapsedMinutes(o.created_at);
            const c = slaColor(min);
            return (
              <div
                key={o.id}
                className={`rounded-lg border ${c.border} bg-[#12151c] flex flex-col animate-slide-in`}
                data-testid={`kds-ticket-${o.number}`}
              >
                <div className={`px-4 py-2 ${c.bg} border-b ${c.border} flex items-center justify-between`}>
                  <div className="font-mono font-bold text-sm">#{o.number}</div>
                  <div className={`text-xs flex items-center gap-1 ${c.text}`}>
                    <Clock size={12} /> {min} min
                  </div>
                </div>
                <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/60 flex items-center justify-between">
                  <span>{o.order_type === "DINE_IN" ? "Stolik" : o.order_type}</span>
                  {o.status === "in_progress" && (
                    <span className="text-amber-400 font-medium">W trakcie</span>
                  )}
                </div>
                <div className="flex-1 p-4 space-y-3">
                  {o.items.map((it, i) => (
                    <div key={i} className="text-sm">
                      <div className="flex items-start justify-between">
                        <div className="font-medium">
                          <span className="font-mono text-blue-400 mr-2">{it.quantity}×</span>
                          {it.product_name}
                        </div>
                      </div>
                      {it.variant_name && (
                        <div className="text-xs text-muted-foreground ml-6">{it.variant_name}</div>
                      )}
                      {it.modifiers.map((m, j) => (
                        <div
                          key={j}
                          className={`text-xs ml-6 font-medium ${
                            m.kind === "ADD" ? "text-emerald-400" : "text-red-400 line-through"
                          }`}
                        >
                          {m.kind === "ADD" ? "+ " : "BEZ "}
                          {m.name.toUpperCase()}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-border/60 flex gap-2">
                  {o.status === "new" && (
                    <Button
                      size="sm"
                      className="flex-1 bg-amber-500 hover:bg-amber-400 text-black"
                      onClick={() => updateStatus(o, "in_progress")}
                      data-testid={`kds-start-${o.number}`}
                    >
                      Rozpocznij
                    </Button>
                  )}
                  {o.status === "in_progress" && (
                    <Button
                      size="sm"
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black"
                      onClick={() => updateStatus(o, "ready")}
                      data-testid={`kds-ready-${o.number}`}
                    >
                      <Check size={14} className="mr-1" /> Gotowe
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-border bg-transparent hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => updateStatus(o, "cancelled")}
                    data-testid={`kds-cancel-${o.number}`}
                  >
                    <X size={14} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
