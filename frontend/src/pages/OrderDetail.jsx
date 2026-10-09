import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";

const STATUS_LABEL = {
  pending_payment: "Oczekuje na płatność",
  new: "Nowe",
  in_progress: "W trakcie",
  ready: "Gotowe",
  in_delivery: "W dostawie",
  completed: "Zrealizowane",
  cancelled: "Anulowane",
};

const TRANSITIONS = {
  new: [
    { s: "in_progress", label: "Rozpocznij produkcję", cls: "bg-amber-500 hover:bg-amber-400 text-black" },
    { s: "cancelled", label: "Anuluj", cls: "bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 text-red-200" },
  ],
  in_progress: [
    { s: "ready", label: "Oznacz jako gotowe", cls: "bg-emerald-500 hover:bg-emerald-400 text-black" },
    { s: "cancelled", label: "Anuluj", cls: "bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 text-red-200" },
  ],
  ready: [
    { s: "in_delivery", label: "Wyślij kuriera", cls: "bg-purple-500 hover:bg-purple-400 text-white" },
    { s: "completed", label: "Zamknij zamówienie", cls: "bg-blue-500 hover:bg-blue-400 text-white" },
  ],
  in_delivery: [{ s: "completed", label: "Dostarczone", cls: "bg-blue-500 hover:bg-blue-400" }],
};

export default function OrderDetail() {
  const { oid } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);

  const load = async () => {
    const { data } = await api.get(`/orders/${oid}`);
    setOrder(data);
  };
  useEffect(() => {
    load();
  }, [oid]);

  const changeStatus = async (s) => {
    try {
      const { data } = await api.put(`/orders/${oid}/status`, { status: s });
      setOrder(data);
      toast.success(`Status: ${STATUS_LABEL[s]}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Błąd");
    }
  };

  if (!order) return <div className="p-8 text-sm text-muted-foreground">Ładowanie…</div>;

  const transitions = TRANSITIONS[order.status] || [];

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <Link to="/orders" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ArrowLeft size={12} /> Powrót do listy
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-blue-400 mb-1">Zamówienie</div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">#{order.number}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {order.order_type} · {new Date(order.created_at).toLocaleString("pl-PL")}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Status</div>
          <div className="font-display text-xl font-semibold mt-1">{STATUS_LABEL[order.status]}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 border border-border bg-[#12151c] rounded-lg p-5">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground mb-3">Pozycje</div>
          <div className="space-y-3">
            {order.items.map((it, i) => (
              <div key={i} className="flex items-start justify-between py-2 border-b border-border/50 last:border-0">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-blue-400 text-sm">{it.quantity}×</span>
                    <span className="font-medium">{it.product_name}</span>
                    {it.variant_name && (
                      <span className="text-xs text-muted-foreground">· {it.variant_name}</span>
                    )}
                  </div>
                  {it.modifiers.map((m, j) => (
                    <div
                      key={j}
                      className={`text-xs ml-6 ${m.kind === "ADD" ? "text-emerald-400" : "text-red-400 line-through"}`}
                    >
                      {m.kind === "ADD" ? "+ " : "× "}
                      {m.name}
                    </div>
                  ))}
                </div>
                <div className="font-mono text-sm">{(it.unit_price * it.quantity).toFixed(2)} zł</div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border space-y-1">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Netto</span>
              <span className="font-mono">{order.totals.net.toFixed(2)} zł</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>VAT</span>
              <span className="font-mono">{order.totals.vat.toFixed(2)} zł</span>
            </div>
            <div className="flex justify-between text-lg font-semibold mt-2">
              <span>Razem</span>
              <span className="font-mono text-blue-400">{order.totals.gross.toFixed(2)} zł</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="border border-border bg-[#12151c] rounded-lg p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground mb-3">Historia</div>
            <div className="space-y-2">
              {order.status_history.map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5" />
                  <div className="flex-1">
                    <div className="font-medium">{STATUS_LABEL[h.status]}</div>
                    <div className="text-muted-foreground">
                      {new Date(h.at).toLocaleTimeString("pl-PL")} · {h.by}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {transitions.length > 0 && (
            <div className="border border-border bg-[#12151c] rounded-lg p-5 space-y-2">
              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground mb-2">Akcje</div>
              {transitions.map((t) => (
                <button
                  key={t.s}
                  onClick={() => changeStatus(t.s)}
                  className={`w-full px-3 py-2 rounded text-sm font-medium transition-colors ${t.cls}`}
                  data-testid={`transition-${t.s}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
