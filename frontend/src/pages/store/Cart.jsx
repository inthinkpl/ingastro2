import { useState } from "react";
import { X, Trash2 } from "lucide-react";
import { money } from "@/lib/store";
import CheckoutForm from "@/pages/store/CheckoutForm";

export default function Cart({ open, onClose, cart, setCart, store, slug }) {
  const [checkout, setCheckout] = useState(false);
  if (!open) return null;
  const subtotal = cart.reduce((a, l) => a + l.line_total, 0);
  const min = store.settings.min_order;

  return (
    <div className="store-panel" role="dialog">
      <div className="backdrop" onClick={onClose} />
      <div className="sheet" data-testid="cart-panel">
        <div className="flex items-center justify-between p-6 border-b border-[#e4dccb]">
          <h2 className="font-serif text-2xl">{checkout ? "Dostawa i płatność" : "Twój koszyk"}</h2>
          <button onClick={onClose} className="p-1 hover:text-[#c8553d]" data-testid="close-cart"><X size={18} /></button>
        </div>

        {checkout ? (
          <CheckoutForm cart={cart} store={store} slug={slug} onBack={() => setCheckout(false)} onDone={() => setCart([])} />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {cart.length === 0 && <p className="text-sm text-neutral-500">Koszyk jest pusty. Wybierz coś z menu.</p>}
              {cart.map((l) => (
                <div key={l.key} className="flex gap-3 items-start" data-testid={`cart-line-${l.product_id}`}>
                  <div className="font-mono text-sm w-8 pt-0.5">{l.quantity}×</div>
                  <div className="flex-1">
                    <div className="font-medium">{l.product_name} <span className="text-neutral-500 text-sm">{l.variant_name}</span></div>
                    {l.modifiers.map((m) => <div key={m.modifier_id} className="text-xs text-neutral-600">{m.kind === "REMOVE" ? "bez " : "+ "}{m.name}</div>)}
                    {l.note && <div className="text-xs italic text-neutral-500">„{l.note}”</div>}
                  </div>
                  <div className="font-mono text-sm">{money(l.line_total)}</div>
                  <button onClick={() => setCart(cart.filter((x) => x.key !== l.key))} className="text-neutral-400 hover:text-[#c8553d]" data-testid={`cart-remove-${l.product_id}`}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <div className="p-6 border-t border-[#e4dccb] space-y-3">
              <div className="flex justify-between text-sm"><span>Razem</span><span className="font-mono" data-testid="cart-subtotal">{money(subtotal)}</span></div>
              {subtotal > 0 && subtotal < min && <p className="text-xs text-[#c8553d]" data-testid="cart-min-warning">Minimalne zamówienie to {money(min)}.</p>}
              <button className="store-btn w-full justify-center" disabled={cart.length === 0 || subtotal < min} onClick={() => setCheckout(true)} data-testid="go-checkout">Przejdź do zamówienia</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
