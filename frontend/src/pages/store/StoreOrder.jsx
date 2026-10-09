import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import { API } from "@/lib/api";
import { money } from "@/lib/store";
import "@/pages/store/store.css";

const STEPS = [
  ["pending_payment", "Oczekuje na płatność"], ["new", "Przyjęte"], ["in_progress", "W przygotowaniu"],
  ["ready", "Gotowe"], ["in_delivery", "W drodze"], ["completed", "Dostarczone"],
];

export default function StoreOrder() {
  const { slug, oid } = useParams();
  const [o, setO] = useState(null);

  useEffect(() => {
    const load = () => axios.get(`${API}/public/orders/${oid}`).then((r) => setO(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [oid]);

  if (!o) return <div className="store min-h-screen grid place-items-center text-neutral-500">Ładowanie…</div>;
  const idx = STEPS.findIndex(([s]) => s === o.status);

  return (
    <div className="store min-h-screen p-6">
      <div className="max-w-xl mx-auto bg-[#fffdf8] border border-[#e4dccb] rounded-2xl p-8 mt-10" data-testid="order-tracking">
        <div className="text-[11px] uppercase tracking-[0.3em] text-[#c8553d]">Zamówienie</div>
        <h1 className="font-serif text-4xl mt-1">#{o.number}</h1>
        <p className="text-neutral-600 text-sm mt-1">{o.customer_name} · {o.order_type === "DELIVERY" ? "dostawa" : "odbiór osobisty"} · płatność: {o.payment_status === "paid" ? "opłacone" : o.payment_status === "cash" ? "przy odbiorze" : "oczekuje"}</p>

        {o.status === "cancelled" ? (
          <div className="mt-6 text-[#c8553d] font-medium" data-testid="order-status">Zamówienie anulowane</div>
        ) : (
          <ol className="mt-8 space-y-3">
            {STEPS.filter(([s]) => s !== "pending_payment" || o.status === "pending_payment").filter(([s]) => s !== "in_delivery" || o.order_type === "DELIVERY").map(([s, l]) => {
              const i = STEPS.findIndex(([x]) => x === s);
              const done = i <= idx;
              return (
                <li key={s} className={`flex items-center gap-3 text-sm ${done ? "" : "text-neutral-400"}`} data-testid={`step-${s}`}>
                  <span className={`w-2.5 h-2.5 rounded-full ${i === idx ? "bg-[#c8553d] ring-4 ring-[#c8553d]/20" : done ? "bg-[#1c1a16]" : "bg-[#d9d0bd]"}`} />
                  {l}
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-8 border-t border-[#e4dccb] pt-5 space-y-2">
          {o.items.map((it, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span><span className="font-mono">{it.quantity}×</span> {it.product_name} <span className="text-neutral-500">{it.variant_name}</span></span>
              <span className="font-mono">{money((it.unit_price + it.modifiers.filter((m) => m.kind === "ADD").reduce((a, m) => a + m.price, 0)) * it.quantity)}</span>
            </div>
          ))}
          {o.totals.delivery_fee > 0 && <div className="flex justify-between text-sm text-neutral-600"><span>Dostawa</span><span className="font-mono">{money(o.totals.delivery_fee)}</span></div>}
          <div className="flex justify-between font-medium pt-2"><span>Razem</span><span className="font-mono" data-testid="order-total">{money(o.totals.gross)}</span></div>
        </div>
        <Link to={`/s/${slug}`} className="store-btn secondary justify-center w-full mt-8" data-testid="back-to-store">Wróć do menu</Link>
      </div>
    </div>
  );
}
