import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const emptyProduct = {
  category_id: "",
  name: "",
  description: "",
  variants: [{ name: "Standard", price: 0 }],
  modifiers: [],
};

export default function Menu() {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCat, setActiveCat] = useState("all");
  const [editing, setEditing] = useState(null);
  const [editCat, setEditCat] = useState(null);

  const load = async () => {
    const [c, p] = await Promise.all([api.get("/menu/categories"), api.get("/menu/products")]);
    setCategories(c.data);
    setProducts(p.data);
  };
  useEffect(() => {
    load();
  }, []);

  const filtered = activeCat === "all" ? products : products.filter((p) => p.category_id === activeCat);

  const saveProduct = async () => {
    if (!editing.name || !editing.category_id) return toast.error("Podaj nazwę i kategorię");
    const payload = {
      ...editing,
      variants: editing.variants.map((v) => ({ ...v, price: parseFloat(v.price) || 0 })),
      modifiers: editing.modifiers.map((m) => ({ ...m, price: parseFloat(m.price) || 0 })),
    };
    try {
      if (editing.id) await api.put(`/menu/products/${editing.id}`, payload);
      else await api.post("/menu/products", payload);
      toast.success("Zapisano");
      setEditing(null);
      load();
    } catch (e) {
      toast.error("Nie można zapisać");
    }
  };

  const deleteProduct = async (p) => {
    if (!window.confirm(`Usunąć ${p.name}?`)) return;
    await api.delete(`/menu/products/${p.id}`);
    load();
  };

  const saveCategory = async () => {
    if (!editCat.name) return;
    try {
      await api.post("/menu/categories", { name: editCat.name, sort: editCat.sort || 0, color: editCat.color });
      setEditCat(null);
      load();
    } catch {
      toast.error("Nie można dodać");
    }
  };

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        eyebrow="Katalog"
        title="Menu"
        description="Zarządzaj kategoriami, produktami, wariantami i modyfikatorami."
        actions={
          <>
            <Button variant="outline" className="border-border bg-transparent" onClick={() => setEditCat({ name: "", color: "#3B82F6" })} data-testid="add-category">
              <Plus size={14} className="mr-1" /> Kategoria
            </Button>
            <Button className="bg-blue-500 hover:bg-blue-400" onClick={() => setEditing({ ...emptyProduct, category_id: categories[0]?.id || "" })} data-testid="add-product">
              <Plus size={14} className="mr-1" /> Produkt
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setActiveCat("all")}
          className={`px-3 py-1.5 rounded-md text-sm border ${activeCat === "all" ? "border-blue-500/50 bg-blue-500/10 text-blue-300" : "border-border text-muted-foreground"}`}
        >
          Wszystkie ({products.length})
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={`px-3 py-1.5 rounded-md text-sm border ${activeCat === c.id ? "border-blue-500/50 bg-blue-500/10 text-blue-300" : "border-border text-muted-foreground"}`}
          >
            <span className="w-2 h-2 rounded-full inline-block mr-2" style={{ background: c.color }} />
            {c.name} ({products.filter((p) => p.category_id === c.id).length})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((p) => {
          const cat = categories.find((c) => c.id === p.category_id);
          return (
            <div key={p.id} className="border border-border bg-[#12151c] rounded-lg p-4" data-testid={`menu-product-${p.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{cat?.name}</div>
                  {p.description && <div className="text-xs text-muted-foreground mt-2 line-clamp-2">{p.description}</div>}
                </div>
                <div className="flex gap-1">
                  <button className="p-1.5 hover:bg-white/5 rounded" onClick={() => setEditing(p)}>
                    <Pencil size={13} />
                  </button>
                  <button className="p-1.5 hover:bg-white/5 rounded hover:text-red-400" onClick={() => deleteProduct(p)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {p.variants.map((v) => (
                  <span key={v.id} className="text-xs font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    {v.name}: {v.price.toFixed(2)} zł
                  </span>
                ))}
              </div>
              {p.modifiers.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {p.modifiers.length} modyfikator{p.modifiers.length === 1 ? "" : "ów"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Product dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edytuj produkt" : "Nowy produkt"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Nazwa</Label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} data-testid="product-name-input" />
                </div>
                <div className="space-y-1.5">
                  <Label>Kategoria</Label>
                  <Select value={editing.category_id} onValueChange={(v) => setEditing({ ...editing, category_id: v })}>
                    <SelectTrigger className="bg-transparent border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Opis</Label>
                <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Warianty (rozmiary)</Label>
                  <Button type="button" size="sm" variant="outline" className="border-border bg-transparent"
                    onClick={() => setEditing({ ...editing, variants: [...editing.variants, { name: "", price: 0 }] })}>
                    <Plus size={12} className="mr-1" /> Dodaj
                  </Button>
                </div>
                {editing.variants.map((v, i) => (
                  <div key={i} className="flex gap-2">
                    <Input placeholder="Nazwa (np. 40 cm)" value={v.name}
                      onChange={(e) => {
                        const nv = [...editing.variants];
                        nv[i].name = e.target.value;
                        setEditing({ ...editing, variants: nv });
                      }} />
                    <Input type="number" step="0.01" placeholder="Cena" value={v.price}
                      onChange={(e) => {
                        const nv = [...editing.variants];
                        nv[i].price = e.target.value;
                        setEditing({ ...editing, variants: nv });
                      }} className="w-28" />
                    <Button type="button" variant="outline" size="icon" className="border-border bg-transparent"
                      onClick={() => setEditing({ ...editing, variants: editing.variants.filter((_, j) => j !== i) })}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Modyfikatory</Label>
                  <Button type="button" size="sm" variant="outline" className="border-border bg-transparent"
                    onClick={() => setEditing({ ...editing, modifiers: [...editing.modifiers, { name: "", kind: "ADD", price: 0 }] })}>
                    <Plus size={12} className="mr-1" /> Dodaj
                  </Button>
                </div>
                {editing.modifiers.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <Input placeholder="Nazwa (np. Dodatkowy ser)" value={m.name}
                      onChange={(e) => {
                        const nm = [...editing.modifiers];
                        nm[i].name = e.target.value;
                        setEditing({ ...editing, modifiers: nm });
                      }} />
                    <Select value={m.kind} onValueChange={(v) => {
                      const nm = [...editing.modifiers];
                      nm[i].kind = v;
                      setEditing({ ...editing, modifiers: nm });
                    }}>
                      <SelectTrigger className="w-28 bg-transparent border-border"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ADD">+ Dodaj</SelectItem>
                        <SelectItem value="REMOVE">× Bez</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input type="number" step="0.01" placeholder="Dopłata" value={m.price}
                      onChange={(e) => {
                        const nm = [...editing.modifiers];
                        nm[i].price = e.target.value;
                        setEditing({ ...editing, modifiers: nm });
                      }} className="w-24" />
                    <Button type="button" variant="outline" size="icon" className="border-border bg-transparent"
                      onClick={() => setEditing({ ...editing, modifiers: editing.modifiers.filter((_, j) => j !== i) })}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-border bg-transparent" onClick={() => setEditing(null)}>Anuluj</Button>
            <Button className="bg-blue-500 hover:bg-blue-400" onClick={saveProduct} data-testid="save-product">Zapisz</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editCat} onOpenChange={(o) => !o && setEditCat(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nowa kategoria</DialogTitle></DialogHeader>
          {editCat && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nazwa</Label>
                <Input value={editCat.name} onChange={(e) => setEditCat({ ...editCat, name: e.target.value })} data-testid="category-name-input" />
              </div>
              <div className="space-y-1.5">
                <Label>Kolor</Label>
                <Input type="color" value={editCat.color} onChange={(e) => setEditCat({ ...editCat, color: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-border bg-transparent" onClick={() => setEditCat(null)}>Anuluj</Button>
            <Button className="bg-blue-500 hover:bg-blue-400" onClick={saveCategory} data-testid="save-category">Zapisz</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
