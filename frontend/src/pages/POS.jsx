import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Minus, Trash2, X, ShoppingBag, Search, Clock, Delete } from "lucide-react";
import api from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

function RcpDialog({ open, onClose, locationId }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const press = (d) => setPin((p) => (p.length >= 6 ? p : p + d));
  const submit = async () => {
    if (pin.length < 4) return toast.error("PIN ma min. 4 cyfry");
    setBusy(true);
    try {
      const { data } = await api.post("/rcp/clock", { pin, location_id: locationId });
      if (data.action === "clock_in") {
        toast.success(`${data.employee_name} – rozpoczęto pracę`);
      } else {
        const h = Math.floor(data.minutes / 60), m = data.minutes % 60;
        toast.success(`${data.employee_name} – zakończono pracę (${h}h ${m}m)`);
      }
      setPin("");
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Nieprawidłowy PIN");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && (setPin(""), onClose())}>
      <DialogContent className="max-w-xs" data-testid="rcp-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clock size={16} className="text-blue-400" /> Zegar RCP</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">Wpisz PIN, aby odbić wejście lub wyjście z pracy.</p>
        <div className="flex justify-center gap-2 my-2" data-testid="rcp-pin-display">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`w-3 h-3 rounded-full ${i < pin.length ? "bg-blue-400" : "bg-white/10"}`} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} onClick={() => press(d)} className="h-14 rounded-md border border-border bg-[#12151c] text-lg font-mono hover:bg-white/5" data-testid={`rcp-key-${d}`}>{d}</button>
          ))}
          <button onClick={() => setPin("")} className="h-14 rounded-md border border-border text-sm text-muted-foreground hover:bg-white/5" data-testid="rcp-key-clear"><X size={16} className="mx-auto" /></button>
          <button onClick={() => press("0")} className="h-14 rounded-md border border-border bg-[#12151c] text-lg font-mono hover:bg-white/5" data-testid="rcp-key-0">0</button>
          <button onClick={() => setPin((p) => p.slice(0, -1))} className="h-14 rounded-md border border-border text-muted-foreground hover:bg-white/5" data-testid="rcp-key-back"><Delete size={16} className="mx-auto" /></button>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} className="w-full bg-blue-500 hover:bg-blue-400" data-testid="rcp-submit">Odbij</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function POS() {
  const { current } = useLocation();
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [tables, setTables] = useState([]);
  const [activeCat, setActiveCat] = useState(null);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState("");
  const [modalProduct, setModalProduct] = useState(null);
  const [modalVariant, setModalVariant] = useState(null);
  const [modalMods, setModalMods] = useState([]);
  const [orderType, setOrderType] = useState("DINE_IN");
  const [selectedTable, setSelectedTable] = useState(null);
  const [rcpOpen, setRcpOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, p] = await Promise.all([api.get("/menu/categories"), api.get("/menu/products")]);
      setCategories(c.data);
      setProducts(p.data);
      if (c.data[0]) setActiveCat(c.data[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!current) return;
    api.get("/tables", { params: { location_id: current.id } }).then((r) => setTables(r.data));
  }, [current]);

  const filtered = useMemo(() => {
    let list = products;
    if (activeCat && !search) list = list.filter((p) => p.category_id === activeCat);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [products, activeCat, search]);

  const openProduct = (p) => {
    setModalProduct(p);
    setModalVariant(p.variants[0] || null);
    setModalMods([]);
  };

  const addToCart = () => {
    if (!modalProduct || !modalVariant) return;
    setCart((c) => [
      ...c,
      {
        line_id: Math.random().toString(36).slice(2),
        product_id: modalProduct.id,
        product_name: modalProduct.name,
        variant_id: modalVariant.id,
        variant_name: modalVariant.name,
        unit_price: modalVariant.price,
        quantity: 1,
        modifiers: modalMods,
        note: "",
      },
    ]);
    setModalProduct(null);
  };

  const changeQty = (line_id, delta) =>
    setCart((c) =>
      c
        .map((it) => (it.line_id === line_id ? { ...it, quantity: Math.max(1, it.quantity + delta) } : it))
        .filter((it) => it.quantity > 0)
    );

  const removeLine = (line_id) => setCart((c) => c.filter((it) => it.line_id !== line_id));

  const toggleMod = (m) => {
    setModalMods((mods) => {
      const exists = mods.find((x) => x.modifier_id === m.id);
      if (exists) return mods.filter((x) => x.modifier_id !== m.id);
      return [...mods, { modifier_id: m.id, name: m.name, kind: m.kind, price: m.price }];
    });
  };

  const total = useMemo(
    () =>
      cart.reduce((s, it) => {
        const mods = it.modifiers.reduce((a, m) => a + (m.kind === "ADD" ? m.price : 0), 0);
        return s + (it.unit_price + mods) * it.quantity;
      }, 0),
    [cart]
  );

  const submit = async () => {
    if (!current) return toast.error("Wybierz lokal");
    if (cart.length === 0) return toast.error("Koszyk jest pusty");
    if (orderType === "DINE_IN" && !selectedTable) return toast.error("Wybierz stolik");
    try {
      const { data } = await api.post("/orders", {
        location_id: current.id,
        order_type: orderType,
        source: "POS",
        table_id: orderType === "DINE_IN" ? selectedTable : null,
        items: cart.map(({ line_id, ...rest }) => rest),
      });
      toast.success(`Zamówienie #${data.number} wysłane do kuchni`);
      setCart([]);
      setSelectedTable(null);
    } catch (e) {
      toast.error("Błąd podczas zapisu zamówienia");
    }
  };

  return (
    <div className="flex h-full">
      {/* Left: Menu */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-border">
        <div className="p-5 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Szukaj dania…"
              className="pl-9 bg-[#12151c] border-border"
              data-testid="pos-search"
            />
          </div>
          <div className="flex gap-2">
            {["DINE_IN", "TAKEAWAY", "DELIVERY"].map((t) => (
              <Button
                key={t}
                variant={orderType === t ? "default" : "outline"}
                className={orderType === t ? "bg-blue-500 hover:bg-blue-400" : "border-border bg-transparent"}
                onClick={() => setOrderType(t)}
                data-testid={`order-type-${t}`}
              >
                {t === "DINE_IN" ? "Na miejscu" : t === "TAKEAWAY" ? "Na wynos" : "Dostawa"}
              </Button>
            ))}
          </div>
          <Button variant="outline" className="border-border bg-transparent gap-2" onClick={() => setRcpOpen(true)} data-testid="rcp-open">
            <Clock size={14} /> Zegar RCP
          </Button>
        </div>

        <div className="px-5 pt-4 flex items-center gap-2 flex-wrap">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setActiveCat(c.id);
                setSearch("");
              }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border ${
                activeCat === c.id && !search
                  ? "border-blue-500/50 bg-blue-500/10 text-blue-300"
                  : "border-border text-muted-foreground hover:bg-white/5"
              }`}
              data-testid={`cat-${c.id}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {orderType === "DINE_IN" && (
          <div className="px-5 pt-4">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground mb-2">Stoliki</div>
            <div className="flex gap-2 flex-wrap">
              {tables.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTable(t.id)}
                  className={`w-14 h-14 rounded-md border font-medium text-sm transition-all ${
                    selectedTable === t.id
                      ? "border-blue-400 bg-blue-500/20 text-blue-200"
                      : "border-border bg-[#12151c] hover:bg-white/5"
                  }`}
                  data-testid={`table-${t.label}`}
                >
                  {t.label}
                </button>
              ))}
              {tables.length === 0 && (
                <div className="text-sm text-muted-foreground">Brak stolików dla tego lokalu</div>
              )}
            </div>
          </div>
        )}

        <ScrollArea className="flex-1 p-5">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => openProduct(p)}
                className="group text-left border border-border bg-[#12151c] rounded-lg p-4 hover:border-blue-500/40 hover:bg-[#161923] transition-colors"
                data-testid={`product-${p.id}`}
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{p.description}</div>
                <div className="mt-3 text-sm font-mono text-blue-400">
                  od {Math.min(...p.variants.map((v) => v.price)).toFixed(2)} zł
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Cart */}
      <aside className="w-96 shrink-0 flex flex-col bg-[#0f1218]">
        <div className="h-16 flex items-center justify-between px-5 border-b border-border">
          <div className="flex items-center gap-2">
            <ShoppingBag size={16} className="text-blue-400" />
            <span className="font-display font-semibold">Rachunek</span>
          </div>
          <span className="text-xs text-muted-foreground">{cart.length} poz.</span>
        </div>

        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/50">
            {cart.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Dodaj pozycje z menu
              </div>
            )}
            {cart.map((it) => {
              const modPrice = it.modifiers.reduce((a, m) => a + (m.kind === "ADD" ? m.price : 0), 0);
              const lineTotal = (it.unit_price + modPrice) * it.quantity;
              return (
                <div key={it.line_id} className="p-4" data-testid={`cart-line-${it.product_id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{it.product_name}</div>
                      <div className="text-xs text-muted-foreground">{it.variant_name}</div>
                      {it.modifiers.map((m) => (
                        <div
                          key={m.modifier_id}
                          className={`text-xs mt-0.5 ${m.kind === "ADD" ? "text-emerald-400" : "text-red-400 line-through"}`}
                        >
                          {m.kind === "ADD" ? "+ " : "× "}
                          {m.name}
                          {m.kind === "ADD" && m.price > 0 ? ` (+${m.price.toFixed(2)} zł)` : ""}
                        </div>
                      ))}
                    </div>
                    <button onClick={() => removeLine(it.line_id)} className="text-muted-foreground hover:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1 border border-border rounded">
                      <button className="px-2 py-1 hover:bg-white/5" onClick={() => changeQty(it.line_id, -1)}>
                        <Minus size={12} />
                      </button>
                      <span className="font-mono text-sm w-6 text-center">{it.quantity}</span>
                      <button className="px-2 py-1 hover:bg-white/5" onClick={() => changeQty(it.line_id, 1)}>
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="font-mono text-sm">{lineTotal.toFixed(2)} zł</div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="p-5 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Razem</span>
            <span className="font-display text-2xl font-semibold" data-testid="cart-total">
              {total.toFixed(2)} zł
            </span>
          </div>
          <Button
            onClick={submit}
            disabled={cart.length === 0}
            className="w-full bg-blue-500 hover:bg-blue-400"
            data-testid="submit-order"
          >
            Wyślij na kuchnię
          </Button>
        </div>
      </aside>

      {/* Product modifiers modal */}
      <Dialog open={!!modalProduct} onOpenChange={(o) => !o && setModalProduct(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{modalProduct?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {modalProduct?.variants?.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground mb-2">Wariant</div>
                <div className="grid grid-cols-2 gap-2">
                  {modalProduct.variants.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setModalVariant(v)}
                      className={`p-2 rounded border text-sm ${
                        modalVariant?.id === v.id
                          ? "border-blue-400 bg-blue-500/10 text-blue-200"
                          : "border-border bg-transparent hover:bg-white/5"
                      }`}
                      data-testid={`variant-${v.id}`}
                    >
                      <div>{v.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{v.price.toFixed(2)} zł</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {modalProduct?.modifiers?.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground mb-2">Modyfikatory</div>
                <div className="space-y-1">
                  {modalProduct.modifiers.map((m) => {
                    const active = modalMods.find((x) => x.modifier_id === m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleMod(m)}
                        className={`w-full flex items-center justify-between p-2 rounded border text-sm ${
                          active ? "border-blue-400 bg-blue-500/10" : "border-border hover:bg-white/5"
                        }`}
                        data-testid={`mod-${m.id}`}
                      >
                        <span className={m.kind === "ADD" ? "text-emerald-300" : "text-red-300"}>
                          {m.kind === "ADD" ? "+ " : "× "}
                          {m.name}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {m.kind === "ADD" && m.price > 0 ? `+${m.price.toFixed(2)} zł` : "—"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalProduct(null)} className="border-border bg-transparent">
              Anuluj
            </Button>
            <Button onClick={addToCart} className="bg-blue-500 hover:bg-blue-400" data-testid="add-to-cart">
              Dodaj do rachunku
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RcpDialog open={rcpOpen} onClose={() => setRcpOpen(false)} locationId={current?.id} />
    </div>
  );
}
