import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, KeyRound } from "lucide-react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLE_LABEL = { manager: "Manager", waiter: "Kelner", cook: "Kucharz", courier: "Kurier" };
const ROLE_COLOR = {
  manager: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  waiter: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  cook: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  courier: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

export default function Employees() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const { data } = await api.get("/employees");
    setRows(data);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    try {
      const payload = { ...editing, hourly_rate: parseFloat(editing.hourly_rate) || 0 };
      if (editing.id) await api.put(`/employees/${editing.id}`, payload);
      else await api.post("/employees", payload);
      setEditing(null);
      load();
      toast.success("Zapisano");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Błąd");
    }
  };

  const del = async (e) => {
    if (!window.confirm(`Usunąć ${e.name}?`)) return;
    await api.delete(`/employees/${e.id}`);
    load();
  };

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        eyebrow="Personel"
        title="Pracownicy"
        description="Zarządzaj zespołem, rolami i PIN-ami do kasy POS."
        actions={
          <Button className="bg-blue-500 hover:bg-blue-400" onClick={() => setEditing({ name: "", role: "waiter", pin: "", hourly_rate: 0 })} data-testid="add-employee">
            <Plus size={14} className="mr-1" /> Dodaj pracownika
          </Button>
        }
      />

      <div className="border border-border bg-[#12151c] rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_120px_120px_80px] text-[11px] uppercase tracking-[0.14em] text-muted-foreground px-5 py-3 border-b border-border">
          <div>Pracownik</div><div>Rola</div><div>Stawka /h</div><div>PIN</div><div></div>
        </div>
        {rows.map((e) => (
          <div key={e.id} className="grid grid-cols-[1fr_140px_120px_120px_80px] px-5 py-3 border-b border-border/50 last:border-0 text-sm items-center" data-testid={`employee-row-${e.id}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/40 grid place-items-center text-xs font-medium text-blue-300">
                {e.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <span className="font-medium">{e.name}</span>
            </div>
            <div><span className={`text-xs px-2 py-0.5 rounded border ${ROLE_COLOR[e.role]}`}>{ROLE_LABEL[e.role]}</span></div>
            <div className="font-mono text-xs text-muted-foreground">{e.hourly_rate.toFixed(2)} zł</div>
            <div className="font-mono text-xs text-muted-foreground flex items-center gap-1"><KeyRound size={11} /> ••••</div>
            <div className="flex gap-1 justify-end">
              <button className="p-1.5 hover:bg-white/5 rounded" onClick={() => setEditing({ ...e, pin: "" })}>
                <Pencil size={13} />
              </button>
              <button className="p-1.5 hover:bg-white/5 rounded hover:text-red-400" onClick={() => del(e)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">Brak pracowników.</div>}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? "Edytuj pracownika" : "Nowy pracownik"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Imię i nazwisko</Label>
                <Input value={editing.name} onChange={(ev) => setEditing({ ...editing, name: ev.target.value })} data-testid="emp-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Rola</Label>
                <Select value={editing.role} onValueChange={(v) => setEditing({ ...editing, role: v })}>
                  <SelectTrigger className="bg-transparent border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>PIN (4–6 cyfr) {editing.id && <span className="text-xs text-muted-foreground">· pozostaw puste aby pominąć zmianę PIN</span>}</Label>
                <Input value={editing.pin} onChange={(ev) => setEditing({ ...editing, pin: ev.target.value.replace(/\D/g, "").slice(0, 6) })} data-testid="emp-pin" />
              </div>
              <div className="space-y-1.5">
                <Label>Stawka godzinowa (zł)</Label>
                <Input type="number" step="0.01" value={editing.hourly_rate} onChange={(ev) => setEditing({ ...editing, hourly_rate: ev.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="border-border bg-transparent" onClick={() => setEditing(null)}>Anuluj</Button>
            <Button className="bg-blue-500 hover:bg-blue-400" onClick={save} data-testid="save-employee">Zapisz</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
