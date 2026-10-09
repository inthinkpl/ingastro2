import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function RecipeEditor({ product, ingredients, onClose, onSaved }) {
  const [lines, setLines] = useState([]);

  useEffect(() => {
    setLines((product?.recipe || []).map((l) => ({ ...l, variant_id: l.variant_id || "all" })));
  }, [product]);

  const upd = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ingName = (id) => ingredients.find((x) => x.id === id);
  const cost = lines.reduce((a, l) => a + (ingName(l.ingredient_id)?.cost_per_unit || 0) * (parseFloat(l.qty) || 0), 0);

  const save = async () => {
    try {
      await api.put(`/inventory/recipes/${product.id}`, {
        recipe: lines.map((l) => ({ ingredient_id: l.ingredient_id, qty: parseFloat(l.qty) || 0, variant_id: l.variant_id === "all" ? null : l.variant_id })),
      });
      toast.success("Receptura zapisana");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Receptura BOM · {product?.name}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">Pozycja z wariantem „Wszystkie” schodzi dla każdego rozmiaru; pozycja przypisana do wariantu – tylko dla niego.</p>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_110px_150px_32px] gap-2 items-center" data-testid={`recipe-line-${i}`}>
              <Select value={l.ingredient_id} onValueChange={(v) => upd(i, { ingredient_id: v })}>
                <SelectTrigger className="bg-transparent border-border" data-testid={`recipe-ingredient-${i}`}><SelectValue placeholder="Składnik…" /></SelectTrigger>
                <SelectContent>{ingredients.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} ({x.unit})</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" step="0.1" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} placeholder="ilość" data-testid={`recipe-qty-${i}`} />
              <Select value={l.variant_id} onValueChange={(v) => upd(i, { variant_id: v })}>
                <SelectTrigger className="bg-transparent border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie</SelectItem>
                  {(product?.variants || []).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-400"><Trash2 size={14} /></button>
            </div>
          ))}
          {lines.length === 0 && <div className="text-sm text-muted-foreground border border-dashed border-border rounded p-6 text-center">Brak pozycji. Dodaj składniki zużywane przez ten produkt.</div>}
        </div>
        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" className="border-border bg-transparent" onClick={() => setLines([...lines, { ingredient_id: "", qty: "", variant_id: "all" }])} data-testid="recipe-add-line">
            <Plus size={14} className="mr-1" /> Dodaj pozycję
          </Button>
          <div className="text-xs text-muted-foreground">Koszt surowców (suma pozycji): <span className="font-mono text-foreground">{cost.toFixed(2)} zł</span></div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border bg-transparent" onClick={onClose}>Anuluj</Button>
          <Button className="bg-blue-500 hover:bg-blue-400" onClick={save} data-testid="recipe-save">Zapisz recepturę</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
