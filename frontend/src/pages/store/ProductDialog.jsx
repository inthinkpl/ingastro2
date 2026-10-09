import { useEffect, useState } from "react";
import { X, Minus, Plus } from "lucide-react";
import { money } from "@/lib/store";

export default function ProductDialog({ product, onClose, onAdd }) {
  const [variant, setVariant] = useState(null);
  const [mods, setMods] = useState([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (product) {
      setVariant(product.variants[0] || null);
      setMods([]);
      setQty(1);
      setNote("");
    }
  }, [product]);

  if (!product || !variant) return null;
  const selected = product.modifiers.filter((m) => mods.includes(m.id));
  const unit = variant.price + selected.filter((m) => m.kind === "ADD").reduce((a, m) => a + m.price, 0);

  const add = () =>
    onAdd({
      key: `${product.id}:${variant.id}:${[...mods].sort().join(",")}:${note}`,
      product_id: product.id, product_name: product.name, variant_id: variant.id, variant_name: variant.name,
      modifier_ids: mods, modifiers: selected, unit_total: unit, quantity: qty, line_total: unit * qty, note,
    });

  return (
    <div className="store-panel" role="dialog">
      <div className="backdrop" onClick={onClose} />
      <div className="sheet" data-testid="product-dialog">
        <div className="flex items-start justify-between p-6 border-b border-[#e4dccb]">
          <div>
            <h2 className="font-serif text-2xl">{product.name}</h2>
            {product.description && <p className="text-sm text-neutral-600 mt-1">{product.description}</p>}
          </div>
          <button onClick={onClose} className="p-1 hover:text-[#c8553d]"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {product.variants.length > 1 && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500 mb-2">Rozmiar</div>
              <div className="grid grid-cols-3 gap-2">
                {product.variants.map((v) => (
                  <button key={v.id} onClick={() => setVariant(v)} className={`store-choice ${variant.id === v.id ? "active" : ""}`} data-testid={`variant-${v.id}`}>
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-neutral-500 font-mono">{money(v.price)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {product.modifiers.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500 mb-2">Dodatki i zmiany</div>
              <div className="space-y-2">
                {product.modifiers.map((m) => (
                  <button key={m.id} onClick={() => setMods(mods.includes(m.id) ? mods.filter((x) => x !== m.id) : [...mods, m.id])} className={`store-choice w-full flex items-center justify-between ${mods.includes(m.id) ? "active" : ""}`} data-testid={`modifier-${m.id}`}>
                    <span>{m.kind === "REMOVE" ? "Bez: " : "+ "}{m.name}</span>
                    <span className="font-mono text-xs text-neutral-500">{m.price ? money(m.price) : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500 mb-2">Uwagi do kuchni</div>
            <input className="store-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="np. mocno wypieczona" data-testid="item-note" />
          </div>
        </div>
        <div className="p-6 border-t border-[#e4dccb] flex items-center gap-4">
          <div className="flex items-center border border-[#d9d0bd] rounded-full">
            <button onClick={() => setQty(Math.max(1, qty - 1))} className="p-2.5" data-testid="qty-minus"><Minus size={14} /></button>
            <span className="w-6 text-center font-mono text-sm" data-testid="qty-value">{qty}</span>
            <button onClick={() => setQty(qty + 1)} className="p-2.5" data-testid="qty-plus"><Plus size={14} /></button>
          </div>
          <button onClick={add} className="store-btn flex-1 justify-center" data-testid="add-to-cart">Dodaj · {money(unit * qty)}</button>
        </div>
      </div>
    </div>
  );
}
