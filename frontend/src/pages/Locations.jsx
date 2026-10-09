import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil } from "lucide-react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const empty = { name: "", address: "", city: "", phone: "", vat_rate: 23 };

export default function Locations() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const { data } = await api.get("/locations");
    setRows(data);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing.name) return toast.error("Podaj nazwę");
    try {
      const payload = { ...editing, vat_rate: parseFloat(editing.vat_rate) || 23 };
      if (editing.id) await api.put(`/locations/${editing.id}`, payload);
      else await api.post("/locations", payload);
      setEditing(null);
      load();
      toast.success("Zapisano");
    } catch {
      toast.error("Błąd");
    }
  };

  const del = async (l) => {
    if (!window.confirm(`Usunąć ${l.name}?`)) return;
    await api.delete(`/locations/${l.id}`);
    load();
  };

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        eyebrow="Sieć"
        title="Lokale"
        description="Zarządzaj punktami sprzedaży w ramach swojej sieci."
        actions={
          <Button className="bg-blue-500 hover:bg-blue-400" onClick={() => setEditing({ ...empty })} data-testid="add-location">
            <Plus size={14} className="mr-1" /> Dodaj lokal
          </Button>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((l) => (
          <div key={l.id} className="border border-border bg-[#12151c] rounded-lg p-5" data-testid={`location-card-${l.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{l.city}</div>
                <div className="font-display text-xl font-semibold mt-0.5">{l.name}</div>
                <div className="text-sm text-muted-foreground mt-2">{l.address}</div>
                <div className="text-sm text-muted-foreground">{l.phone}</div>
                <div className="text-xs font-mono text-blue-400 mt-2">VAT {l.vat_rate}%</div>
              </div>
              <div className="flex gap-1">
                <button className="p-1.5 hover:bg-white/5 rounded" onClick={() => setEditing(l)}>
                  <Pencil size={14} />
                </button>
                <button className="p-1.5 hover:bg-white/5 rounded hover:text-red-400" onClick={() => del(l)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? "Edytuj lokal" : "Nowy lokal"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              {["name", "address", "city", "phone"].map((k) => (
                <div key={k} className="space-y-1.5">
                  <Label className="capitalize">{k === "name" ? "Nazwa" : k === "address" ? "Adres" : k === "city" ? "Miasto" : "Telefon"}</Label>
                  <Input value={editing[k]} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} data-testid={`loc-${k}`} />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label>Stawka VAT %</Label>
                <Input type="number" step="0.01" value={editing.vat_rate} onChange={(e) => setEditing({ ...editing, vat_rate: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-border bg-transparent" onClick={() => setEditing(null)}>Anuluj</Button>
            <Button className="bg-blue-500 hover:bg-blue-400" onClick={save} data-testid="save-location">Zapisz</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
