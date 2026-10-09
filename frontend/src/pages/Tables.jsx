import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useLocation } from "@/contexts/LocationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Tables() {
  const { current } = useLocation();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    if (!current) return;
    const { data } = await api.get("/tables", { params: { location_id: current.id } });
    setRows(data);
  };
  useEffect(() => {
    load();
  }, [current]);

  const save = async () => {
    try {
      const payload = { ...editing, location_id: current.id, seats: parseInt(editing.seats) || 2 };
      if (editing.id) await api.put(`/tables/${editing.id}`, payload);
      else await api.post("/tables", payload);
      setEditing(null);
      load();
    } catch {
      toast.error("Błąd");
    }
  };

  const del = async (t) => {
    if (!window.confirm(`Usunąć ${t.label}?`)) return;
    await api.delete(`/tables/${t.id}`);
    load();
  };

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        eyebrow="Sala"
        title="Stoliki"
        description={`${current?.name} · ${rows.length} stolików`}
        actions={
          <Button className="bg-blue-500 hover:bg-blue-400" onClick={() => setEditing({ label: "", seats: 2, shape: "round" })} data-testid="add-table">
            <Plus size={14} className="mr-1" /> Dodaj stolik
          </Button>
        }
      />
      <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-3">
        {rows.map((t) => (
          <div key={t.id} className="group border border-border bg-[#12151c] rounded-lg p-4 text-center relative" data-testid={`tables-card-${t.label}`}>
            <div className={`w-14 h-14 mx-auto border-2 border-blue-500/40 ${t.shape === "round" ? "rounded-full" : "rounded"} grid place-items-center bg-blue-500/5`}>
              <span className="font-display font-semibold">{t.label}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-2">{t.seats} miejsc</div>
            <button onClick={() => del(t)} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nowy stolik</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Etykieta</Label>
                <Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} data-testid="table-label" />
              </div>
              <div className="space-y-1.5">
                <Label>Miejsca</Label>
                <Input type="number" value={editing.seats} onChange={(e) => setEditing({ ...editing, seats: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Kształt</Label>
                <Select value={editing.shape} onValueChange={(v) => setEditing({ ...editing, shape: v })}>
                  <SelectTrigger className="bg-transparent border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="round">Okrągły</SelectItem>
                    <SelectItem value="square">Kwadratowy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-border bg-transparent" onClick={() => setEditing(null)}>Anuluj</Button>
            <Button className="bg-blue-500 hover:bg-blue-400" onClick={save} data-testid="save-table">Zapisz</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
