import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Trash2, AlertTriangle, Truck, Trash, SlidersHorizontal, ChefHat } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useLocation } from "@/contexts/LocationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import RecipeEditor from "@/components/inventory/RecipeEditor";

const UNITS = ["g", "kg", "ml", "l", "szt"];
const MOVE_LABEL = { delivery: "Dostawa", waste: "Straty", adjust: "Korekta", order: "Zamówienie", cancel_return: "Zwrot (anulacja)" };

export default function Inventory() {
  const { current } = useLocation();
  const [stock, setStock] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [movements, setMovements] = useState([]);
  const [products, setProducts] = useState([]);
  const [editIng, setEditIng] = useState(null);
  const [move, setMove] = useState(null);
  const [recipeProduct, setRecipeProduct] = useState(null);

  const load = useCallback(async () => {
    if (!current) return;
    const [s, i, m, p] = await Promise.all([
      api.get("/inventory/stock", { params: { location_id: current.id } }),
      api.get("/inventory/ingredients"),
      api.get("/inventory/movements", { params: { location_id: current.id } }),
      api.get("/menu/products"),
    ]);
    setStock(s.data);
    setIngredients(i.data);
    setMovements(m.data);
    setProducts(p.data);
  }, [current]);

  useEffect(() => {
    load();
  }, [load]);

  const saveIng = async () => {
    try {
      const payload = { ...editIng, cost_per_unit: parseFloat(editIng.cost_per_unit) || 0, min_stock: parseFloat(editIng.min_stock) || 0 };
      if (editIng.id) await api.put(`/inventory/ingredients/${editIng.id}`, payload);
      else await api.post("/inventory/ingredients", payload);
      setEditIng(null);
      toast.success("Zapisano składnik");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const delIng = async (i) => {
    if (!window.confirm(`Usunąć składnik ${i.name}?`)) return;
    await api.delete(`/inventory/ingredients/${i.id}`);
    load();
  };

  const saveMove = async () => {
    try {
      await api.post("/inventory/movements", { ...move, location_id: current.id, qty: parseFloat(move.qty) });
      setMove(null);
      toast.success("Zapisano ruch magazynowy");
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const lowCount = stock.filter((s) => s.low).length;
  const stockValue = stock.reduce((a, s) => a + s.value, 0);

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        eyebrow="Magazyn & BOM"
        title="Magazyn"
        description={`${current?.name} · ${stock.length} składników · wartość ${stockValue.toFixed(2)} zł`}
        actions={
          <>
            <Button variant="outline" className="border-border bg-transparent" onClick={() => setMove({ type: "delivery", ingredient_id: "", qty: "", note: "" })} data-testid="add-delivery">
              <Truck size={14} className="mr-1" /> Dostawa / Straty
            </Button>
            <Button className="bg-blue-500 hover:bg-blue-400" onClick={() => setEditIng({ name: "", unit: "g", cost_per_unit: 0, min_stock: 0 })} data-testid="add-ingredient">
              <Plus size={14} className="mr-1" /> Składnik
            </Button>
          </>
        }
      />

      {lowCount > 0 && (
        <div className="flex items-center gap-3 border border-amber-500/30 bg-amber-500/10 rounded-lg px-4 py-3 text-sm text-amber-200" data-testid="low-stock-alert">
          <AlertTriangle size={16} />
          {lowCount} składników poniżej stanu minimalnego: {stock.filter((s) => s.low).map((s) => s.name).join(", ")}
        </div>
      )}

      <Tabs defaultValue="stock">
        <TabsList className="bg-[#12151c] border border-border">
          <TabsTrigger value="stock" data-testid="tab-stock">Stany lokalu</TabsTrigger>
          <TabsTrigger value="ingredients" data-testid="tab-ingredients">Kartoteka składników</TabsTrigger>
          <TabsTrigger value="recipes" data-testid="tab-recipes">Receptury BOM</TabsTrigger>
          <TabsTrigger value="movements" data-testid="tab-movements">Ruchy magazynowe</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-4">
          <div className="border border-border rounded-lg overflow-hidden bg-[#12151c]">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
                <tr><th className="text-left px-4 py-3">Składnik</th><th className="text-right px-4 py-3">Stan</th><th className="text-right px-4 py-3">Minimum</th><th className="text-right px-4 py-3">Wartość</th><th className="px-4 py-3"></th></tr>
              </thead>
              <tbody>
                {stock.map((s) => (
                  <tr key={s.id} className="border-t border-border/60" data-testid={`stock-row-${s.id}`}>
                    <td className="px-4 py-2.5 font-medium">{s.name}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${s.low ? "text-amber-400" : ""}`} data-testid={`stock-qty-${s.id}`}>{s.qty} {s.unit}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground font-mono">{s.min_stock} {s.unit}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{s.value.toFixed(2)} zł</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setMove({ type: "delivery", ingredient_id: s.id, qty: "", note: "" })} data-testid={`stock-delivery-${s.id}`}>+ Dostawa</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="ingredients" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {ingredients.map((i) => (
              <div key={i.id} className="group border border-border bg-[#12151c] rounded-lg p-4 flex items-start justify-between" data-testid={`ingredient-card-${i.id}`}>
                <div>
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{i.cost_per_unit.toFixed(3)} zł / {i.unit} · min {i.min_stock} {i.unit}</div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="sm" variant="ghost" onClick={() => setEditIng(i)} data-testid={`edit-ingredient-${i.id}`}>Edytuj</Button>
                  <Button size="sm" variant="ghost" className="hover:text-red-400" onClick={() => delIng(i)}><Trash2 size={14} /></Button>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="recipes" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {products.map((p) => (
              <button key={p.id} onClick={() => setRecipeProduct(p)} className="text-left border border-border bg-[#12151c] rounded-lg p-4 hover:border-blue-500/40 transition-colors" data-testid={`recipe-card-${p.id}`}>
                <div className="flex items-center justify-between">
                  <div className="font-medium">{p.name}</div>
                  <ChefHat size={14} className="text-muted-foreground" />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {(p.recipe || []).length ? `${p.recipe.length} pozycji BOM` : "Brak receptury – kliknij, aby dodać"}
                  {p.sku && <span className="ml-2 font-mono">SKU {p.sku}</span>}
                </div>
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="movements" className="mt-4">
          <div className="border border-border rounded-lg overflow-hidden bg-[#12151c]">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
                <tr><th className="text-left px-4 py-3">Kiedy</th><th className="text-left px-4 py-3">Typ</th><th className="text-left px-4 py-3">Składnik</th><th className="text-right px-4 py-3">Zmiana</th><th className="text-left px-4 py-3">Notatka</th></tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-t border-border/60" data-testid={`movement-row-${m.id}`}>
                    <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{new Date(m.at).toLocaleString("pl-PL")}</td>
                    <td className="px-4 py-2">{MOVE_LABEL[m.type] || m.type}</td>
                    <td className="px-4 py-2">{m.ingredient_name}</td>
                    <td className={`px-4 py-2 text-right font-mono ${m.delta < 0 ? "text-red-400" : "text-emerald-400"}`}>{m.delta > 0 ? "+" : ""}{m.delta} {m.unit}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{m.note} {m.ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editIng} onOpenChange={(o) => !o && setEditIng(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editIng?.id ? "Edytuj składnik" : "Nowy składnik"}</DialogTitle></DialogHeader>
          {editIng && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Nazwa</Label><Input value={editIng.name} onChange={(e) => setEditIng({ ...editIng, name: e.target.value })} data-testid="ingredient-name" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label>Jednostka</Label>
                  <Select value={editIng.unit} onValueChange={(v) => setEditIng({ ...editIng, unit: v })}>
                    <SelectTrigger className="bg-transparent border-border" data-testid="ingredient-unit"><SelectValue /></SelectTrigger>
                    <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Koszt / jedn.</Label><Input type="number" step="0.001" value={editIng.cost_per_unit} onChange={(e) => setEditIng({ ...editIng, cost_per_unit: e.target.value })} data-testid="ingredient-cost" /></div>
                <div className="space-y-1.5"><Label>Stan min.</Label><Input type="number" value={editIng.min_stock} onChange={(e) => setEditIng({ ...editIng, min_stock: e.target.value })} data-testid="ingredient-min" /></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-border bg-transparent" onClick={() => setEditIng(null)}>Anuluj</Button>
            <Button className="bg-blue-500 hover:bg-blue-400" onClick={saveIng} data-testid="save-ingredient">Zapisz</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!move} onOpenChange={(o) => !o && setMove(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Ruch magazynowy · {current?.name}</DialogTitle></DialogHeader>
          {move && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[["delivery", "Dostawa", Truck], ["waste", "Straty", Trash], ["adjust", "Korekta", SlidersHorizontal]].map(([k, l, Icon]) => (
                  <button key={k} onClick={() => setMove({ ...move, type: k })} className={`border rounded-md py-2 text-xs flex flex-col items-center gap-1 ${move.type === k ? "border-blue-500 bg-blue-500/10 text-blue-300" : "border-border text-muted-foreground"}`} data-testid={`move-type-${k}`}>
                    <Icon size={14} />{l}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5"><Label>Składnik</Label>
                <Select value={move.ingredient_id} onValueChange={(v) => setMove({ ...move, ingredient_id: v })}>
                  <SelectTrigger className="bg-transparent border-border" data-testid="move-ingredient"><SelectValue placeholder="Wybierz…" /></SelectTrigger>
                  <SelectContent>{ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Ilość {move.type === "adjust" && "(ujemna = odejmij)"}</Label><Input type="number" step="0.01" value={move.qty} onChange={(e) => setMove({ ...move, qty: e.target.value })} data-testid="move-qty" /></div>
              <div className="space-y-1.5"><Label>Notatka</Label><Input value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} data-testid="move-note" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-border bg-transparent" onClick={() => setMove(null)}>Anuluj</Button>
            <Button className="bg-blue-500 hover:bg-blue-400" onClick={saveMove} disabled={!move?.ingredient_id || !move?.qty} data-testid="save-move">Zapisz</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecipeEditor product={recipeProduct} ingredients={ingredients} onClose={() => setRecipeProduct(null)} onSaved={load} />
    </div>
  );
}
