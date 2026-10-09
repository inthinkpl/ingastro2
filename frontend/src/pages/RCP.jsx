import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Download, Clock, Users } from "lucide-react";
import api from "@/lib/api";
import { useLocation } from "@/contexts/LocationContext";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
const fmtH = (h) => `${Math.floor(h)}h ${Math.round((h - Math.floor(h)) * 60)}m`;

export default function RCP() {
  const { current } = useLocation();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [report, setReport] = useState(null);
  const [active, setActive] = useState([]);

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([
      api.get("/rcp/report", { params: { date_from: from, date_to: to } }),
      api.get("/rcp/active", { params: current ? { location_id: current.id } : {} }),
    ]);
    setReport(r.data);
    setActive(a.data);
  }, [from, to, current]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => api.get("/rcp/active", { params: current ? { location_id: current.id } : {} }).then((r) => setActive(r.data)).catch(() => {}), 15000); return () => clearInterval(t); }, [current]);

  const exportCsv = () => {
    if (!report?.rows?.length) return toast.error("Brak danych do eksportu");
    const head = ["Pracownik", "Rola", "Zmiany", "Godziny", "Stawka (zł/h)", "Do wypłaty (zł)"];
    const lines = report.rows.map((r) => [r.employee_name, r.role, r.shifts, r.hours, r.hourly_rate, r.amount].join(";"));
    const csv = [head.join(";"), ...lines, ["RAZEM", "", "", report.total_hours, "", report.total_amount].join(";")].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `rcp_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Pobrano raport CSV");
  };

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <PageHeader eyebrow="Personel" title="RCP – Czas pracy" description="Ewidencja godzin pracy pracowników i raport do wypłat." />

      <section className="border border-border rounded-lg bg-[#12151c] p-6 space-y-4" data-testid="rcp-active-section">
        <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Users size={16} className="text-emerald-400" /> Obecnie w pracy <span className="text-sm text-muted-foreground font-normal">({active.length})</span></h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nikt nie jest teraz zalogowany na zmianie.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {active.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border border-emerald-500/20 bg-emerald-500/5 rounded-md px-4 py-2" data-testid={`rcp-active-${a.employee_id}`}>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <div>
                  <div className="text-sm font-medium">{a.employee_name}</div>
                  <div className="text-xs text-muted-foreground">od {new Date(a.clock_in).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })} · {a.role}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border border-border rounded-lg bg-[#12151c] p-6 space-y-4" data-testid="rcp-report-section">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Clock size={16} className="text-blue-400" /> Raport godzin</h2>
          <div className="flex items-end gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Od</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" data-testid="rcp-from" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Do</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" data-testid="rcp-to" /></div>
            <Button variant="outline" className="border-border bg-transparent gap-2" onClick={exportCsv} data-testid="rcp-export">
              <Download size={14} /> Eksport CSV
            </Button>
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_110px_110px_130px] text-[11px] uppercase tracking-[0.14em] text-muted-foreground px-5 py-3 border-b border-border">
            <div>Pracownik</div><div>Zmiany</div><div>Godziny</div><div>Stawka</div><div className="text-right">Do wypłaty</div>
          </div>
          {!report?.rows?.length && <div className="p-10 text-center text-sm text-muted-foreground">Brak zarejestrowanych godzin w tym okresie.</div>}
          {report?.rows?.map((r) => (
            <div key={r.employee_id} className="grid grid-cols-[1fr_120px_110px_110px_130px] px-5 py-3 text-sm border-b border-border/50 items-center" data-testid={`rcp-row-${r.employee_id}`}>
              <div><div className="font-medium">{r.employee_name}</div><div className="text-xs text-muted-foreground capitalize">{r.role}</div></div>
              <div className="font-mono text-muted-foreground">{r.shifts}</div>
              <div className="font-mono">{fmtH(r.hours)}</div>
              <div className="font-mono text-muted-foreground">{r.hourly_rate.toFixed(2)} zł</div>
              <div className="text-right font-mono text-blue-400">{r.amount.toFixed(2)} zł</div>
            </div>
          ))}
          {report?.rows?.length > 0 && (
            <div className="grid grid-cols-[1fr_120px_110px_110px_130px] px-5 py-3 text-sm items-center bg-white/[0.02]">
              <div className="font-semibold">RAZEM</div><div /><div className="font-mono font-semibold">{fmtH(report.total_hours)}</div><div /><div className="text-right font-mono font-semibold text-emerald-400" data-testid="rcp-total">{report.total_amount.toFixed(2)} zł</div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
