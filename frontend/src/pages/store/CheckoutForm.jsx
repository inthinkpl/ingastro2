import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, formatApiError } from "@/lib/api";
import { money } from "@/lib/store";

export default function CheckoutForm({ cart, store, slug, onBack, onDone }) {
  const navigate = useNavigate();
  const onlineAvailable = store.settings.payment_provider === "stripe" || store.payu_configured;
  const [f, setF] = useState({
    location_id: store.locations[0]?.id || "", order_type: "DELIVERY", customer_name: "", customer_phone: "",
    customer_email: "", customer_address: "", payment_method: onlineAvailable ? "online" : "cash", note: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const subtotal = cart.reduce((a, l) => a + l.line_total, 0);
  const fee = f.order_type === "DELIVERY" ? store.settings.delivery_fee : 0;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const { data: order } = await axios.post(`${API}/public/store/${slug}/orders`, {
        ...f,
        items: cart.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity, modifier_ids: l.modifier_ids, note: l.note })),
      });
      if (f.payment_method === "online") {
        const { data } = await axios.post(`${API}/public/store/${slug}/checkout`, { order_id: order.id, origin_url: window.location.origin });
        onDone();
        window.location.href = data.checkout_url;
        return;
      }
      onDone();
      navigate(`/s/${slug}/order/${order.id}`);
    } catch (ex) {
      setErr(formatApiError(ex?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex-1 flex flex-col min-h-0" data-testid="checkout-form">
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="grid grid-cols-2 gap-2">
          {[["DELIVERY", "Dostawa"], ["TAKEAWAY", "Odbiór osobisty"]].map(([k, l]) => (
            <button type="button" key={k} onClick={() => setF({ ...f, order_type: k })} className={`store-choice ${f.order_type === k ? "active" : ""}`} data-testid={`order-type-${k}`}>{l}</button>
          ))}
        </div>
        {store.locations.length > 1 && (
          <select className="store-input" value={f.location_id} onChange={set("location_id")} data-testid="checkout-location">
            {store.locations.map((l) => <option key={l.id} value={l.id}>{l.name} – {l.address}</option>)}
          </select>
        )}
        <input className="store-input" required placeholder="Imię i nazwisko" value={f.customer_name} onChange={set("customer_name")} data-testid="checkout-name" />
        <div className="grid grid-cols-2 gap-2">
          <input className="store-input" required placeholder="Telefon" value={f.customer_phone} onChange={set("customer_phone")} data-testid="checkout-phone" />
          <input className="store-input" type="email" placeholder="E-mail (paragon)" value={f.customer_email} onChange={set("customer_email")} data-testid="checkout-email" />
        </div>
        {f.order_type === "DELIVERY" && (
          <input className="store-input" required placeholder="Adres dostawy" value={f.customer_address} onChange={set("customer_address")} data-testid="checkout-address" />
        )}
        <textarea className="store-input" rows={2} placeholder="Uwagi do zamówienia" value={f.note} onChange={set("note")} data-testid="checkout-note" />

        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500 mb-2">Płatność</div>
          <div className="grid grid-cols-2 gap-2">
            {onlineAvailable && (
              <button type="button" onClick={() => setF({ ...f, payment_method: "online" })} className={`store-choice ${f.payment_method === "online" ? "active" : ""}`} data-testid="pay-online">
                <div className="font-medium">Online</div>
                <div className="text-xs text-neutral-500">{store.settings.payment_provider === "payu" ? "PayU · BLIK, karta, przelew" : "Stripe · karta, BLIK, P24"}</div>
              </button>
            )}
            {store.settings.accept_cash && (
              <button type="button" onClick={() => setF({ ...f, payment_method: "cash" })} className={`store-choice ${f.payment_method === "cash" ? "active" : ""}`} data-testid="pay-cash">
                <div className="font-medium">Przy odbiorze</div>
                <div className="text-xs text-neutral-500">Gotówka lub terminal</div>
              </button>
            )}
          </div>
        </div>
        {err && <p className="text-sm text-[#c8553d]" data-testid="checkout-error">{err}</p>}
      </div>
      <div className="p-6 border-t border-[#e4dccb] space-y-2">
        <div className="flex justify-between text-sm text-neutral-600"><span>Pozycje</span><span className="font-mono">{money(subtotal)}</span></div>
        {fee > 0 && <div className="flex justify-between text-sm text-neutral-600"><span>Dostawa</span><span className="font-mono">{money(fee)}</span></div>}
        <div className="flex justify-between font-medium"><span>Do zapłaty</span><span className="font-mono" data-testid="checkout-total">{money(subtotal + fee)}</span></div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onBack} className="store-btn secondary" data-testid="checkout-back">Wstecz</button>
          <button type="submit" disabled={busy} className="store-btn flex-1 justify-center" data-testid="checkout-submit">
            {busy ? "Przetwarzanie…" : f.payment_method === "online" ? "Zapłać online" : "Złóż zamówienie"}
          </button>
        </div>
      </div>
    </form>
  );
}
