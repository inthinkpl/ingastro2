import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { ShoppingBag, MapPin, Clock } from "lucide-react";
import { API } from "@/lib/api";
import { money } from "@/lib/store";
import ProductDialog from "@/pages/store/ProductDialog";
import Cart from "@/pages/store/Cart";
import "@/pages/store/store.css";

export default function Store() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [cat, setCat] = useState(null);
  const [picked, setPicked] = useState(null);
  const [cart, setCart] = useState(() => JSON.parse(localStorage.getItem(`ig_cart_${slug}`) || "[]"));
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    axios.get(`${API}/public/store/${slug}`).then((r) => {
      setData(r.data);
      setCat(r.data.categories[0]?.id || null);
    }).catch((e) => setError(e?.response?.data?.detail || "Nie można załadować sklepu"));
  }, [slug]);

  useEffect(() => {
    localStorage.setItem(`ig_cart_${slug}`, JSON.stringify(cart));
  }, [cart, slug]);

  const products = useMemo(() => (data?.products || []).filter((p) => p.category_id === cat), [data, cat]);
  const count = cart.reduce((a, l) => a + l.quantity, 0);
  const subtotal = cart.reduce((a, l) => a + l.line_total, 0);

  const addLine = (line) => {
    setCart((c) => {
      const same = c.find((x) => x.key === line.key);
      if (same) return c.map((x) => (x.key === line.key ? { ...x, quantity: x.quantity + line.quantity, line_total: (x.quantity + line.quantity) * x.unit_total } : x));
      return [...c, line];
    });
    setPicked(null);
    setCartOpen(true);
  };

  if (error) return <div className="store min-h-screen grid place-items-center text-center p-8"><div><div className="font-serif text-3xl mb-2">Ups.</div><p className="text-neutral-600" data-testid="store-error">{error}</p></div></div>;
  if (!data) return <div className="store min-h-screen grid place-items-center text-neutral-500">Ładowanie menu…</div>;

  return (
    <div className="store min-h-screen">
      <header className="store-hero">
        <div className="max-w-6xl mx-auto px-6 py-14 md:py-20 flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div className="max-w-xl">
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#c8553d] mb-3">Zamów online</div>
            <h1 className="font-serif text-5xl md:text-6xl leading-[0.95] tracking-tight" data-testid="store-name">{data.tenant.name}</h1>
            {data.settings.store_description && <p className="mt-5 text-neutral-700 text-base md:text-lg leading-relaxed">{data.settings.store_description}</p>}
            <div className="mt-6 flex flex-wrap gap-5 text-sm text-neutral-600">
              <span className="flex items-center gap-1.5"><MapPin size={14} /> {data.locations.map((l) => l.city).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</span>
              <span className="flex items-center gap-1.5"><Clock size={14} /> ok. 40 min</span>
              <span>Dostawa {money(data.settings.delivery_fee)} · min. {money(data.settings.min_order)}</span>
            </div>
          </div>
          <button onClick={() => setCartOpen(true)} className="store-btn self-start md:self-auto" data-testid="open-cart">
            <ShoppingBag size={16} /> Koszyk {count > 0 && <span className="store-badge">{count}</span>} {subtotal > 0 && <span className="opacity-80">· {money(subtotal)}</span>}
          </button>
        </div>
      </header>

      <nav className="sticky top-0 z-20 bg-[#f6f1e7]/90 backdrop-blur border-y border-[#e4dccb]">
        <div className="max-w-6xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {data.categories.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} className={`store-tab ${cat === c.id ? "active" : ""}`} data-testid={`store-cat-${c.id}`}>{c.name}</button>
          ))}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((p, i) => {
            const from = Math.min(...p.variants.map((v) => v.price));
            return (
              <button key={p.id} onClick={() => setPicked(p)} className="store-card" style={{ animationDelay: `${i * 40}ms` }} data-testid={`store-product-${p.id}`}>
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-serif text-xl leading-tight">{p.name}</h3>
                  <span className="font-mono text-sm whitespace-nowrap">{p.variants.length > 1 ? "od " : ""}{money(from)}</span>
                </div>
                {p.description && <p className="text-sm text-neutral-600 mt-2 leading-relaxed">{p.description}</p>}
                <div className="mt-4 text-xs uppercase tracking-[0.2em] text-[#c8553d]">Dodaj →</div>
              </button>
            );
          })}
          {products.length === 0 && <div className="col-span-full text-neutral-500 text-sm">Brak pozycji w tej kategorii.</div>}
        </div>
      </main>

      <footer className="border-t border-[#e4dccb] py-8 text-center text-xs text-neutral-500">Zasilane przez inGastro Cloud OS</footer>

      <ProductDialog product={picked} onClose={() => setPicked(null)} onAdd={addLine} />
      <Cart open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} setCart={setCart} store={data} slug={slug} />
    </div>
  );
}
