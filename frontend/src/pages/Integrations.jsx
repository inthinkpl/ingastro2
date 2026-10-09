import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { KeyRound, Send, UploadCloud, Copy, Download } from "lucide-react";
import api, { API, formatApiError } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useLocation } from "@/contexts/LocationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export default function Integrations() {
  const { current } = useLocation();
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [menuPreview, setMenuPreview] = useState(null);

  const load = useCallback(async () => {
    if (!current) return;
    const { data } = await api.get("/integrations/pyszne", { params: { location_id: current.id } });
    setCfg(data);
  }, [current]);
  useEffect(() => {
    load();
  }, [load]);

  const call = async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast.success(ok(r.data));
      await load();
      return r.data;
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <div className="p-8 text-sm text-muted-foreground">Ładowanie…</div>;
  const webhook = `${API}/integrations/pyszne/orders`;

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <PageHeader eyebrow="Integracje" title="Pyszne.pl" description={`${current?.name} · Order Ingestion API + Menu Push`} />

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
        <section className="border border-border rounded-lg bg-[#12151c] p-6 space-y-4" data-testid="pyszne-config">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg font-semibold">Order Ingestion</div>
              <div className="text-xs text-muted-foreground">Zamówienia z Pyszne.pl trafiają wprost na KDS ze źródłem „PYSZNE.PL”.</div>
            </div>
            <Switch checked={cfg.enabled} disabled={!cfg.api_key} onCheckedChange={(v) => call(() => api.put("/integrations/pyszne", { location_id: current.id, enabled: v }))} data-testid="pyszne-enabled" />
          </div>

          <div className="space-y-1.5">
            <Label>Webhook URL (podaj w panelu partnera Pyszne.pl)</Label>
            <div className="flex gap-2">
              <code className="flex-1 text-xs bg-black/30 border border-border rounded px-3 py-2 truncate" data-testid="pyszne-webhook-url">{webhook}</code>
              <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(webhook); toast.success("Skopiowano"); }}><Copy size={14} /></Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Klucz API lokalu (nagłówek X-Pyszne-Api-Key)</Label>
            <div className="flex gap-2">
              <code className="flex-1 text-xs bg-black/30 border border-border rounded px-3 py-2 truncate font-mono" data-testid="pyszne-api-key">{cfg.api_key || "— nie wygenerowano —"}</code>
              {cfg.api_key && <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(cfg.api_key); toast.success("Skopiowano"); }}><Copy size={14} /></Button>}
              <Button size="sm" variant="outline" className="border-border bg-transparent" disabled={busy} onClick={() => call(() => api.post("/integrations/pyszne/generate-key", { location_id: current.id }), () => "Wygenerowano nowy klucz")} data-testid="pyszne-generate-key">
                <KeyRound size={14} className="mr-1" /> {cfg.api_key ? "Rotuj" : "Generuj"}
              </Button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Restaurant ID w Pyszne.pl</Label>
              <Input value={cfg.restaurant_id} onChange={(e) => setCfg({ ...cfg, restaurant_id: e.target.value })} data-testid="pyszne-restaurant-id" />
            </div>
            <div className="space-y-1.5">
              <Label>Menu Push URL (endpoint partnera)</Label>
              <Input placeholder="https://partner-api.takeaway.com/…/menu" value={cfg.menu_push_url} onChange={(e) => setCfg({ ...cfg, menu_push_url: e.target.value })} data-testid="pyszne-push-url" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="bg-blue-500 hover:bg-blue-400" disabled={busy} onClick={() => call(() => api.put("/integrations/pyszne", { location_id: current.id, restaurant_id: cfg.restaurant_id, menu_push_url: cfg.menu_push_url }), () => "Zapisano")} data-testid="pyszne-save">Zapisz</Button>
            <Button variant="outline" className="border-border bg-transparent" disabled={busy || !cfg.api_key} onClick={() => call(() => api.post("/integrations/pyszne/test-order", { location_id: current.id }), (d) => `Zamówienie testowe #${d.number} trafiło na KDS (${d.unmapped_items} niezmapowanych)`)} data-testid="pyszne-test-order">
              <Send size={14} className="mr-1" /> Wyślij testowe zamówienie
            </Button>
          </div>
        </section>

        <section className="border border-border rounded-lg bg-[#12151c] p-6 space-y-4" data-testid="pyszne-menu-push">
          <div className="font-display text-lg font-semibold">Menu Push</div>
          <p className="text-xs text-muted-foreground">Eksport menu (kategorie, produkty, SKU, warianty, dodatki) w formacie JSON. Bez podanego URL push jest symulowany i logowany.</p>
          <div className="text-xs text-muted-foreground">
            Ostatni push: <span className="text-foreground" data-testid="pyszne-last-push">{cfg.last_push_at ? `${new Date(cfg.last_push_at).toLocaleString("pl-PL")} · ${cfg.last_push_status}` : "nigdy"}</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button className="bg-blue-500 hover:bg-blue-400" disabled={busy} onClick={() => call(() => api.post("/integrations/pyszne/menu-push", { location_id: current.id }), (d) => `Wypchnięto ${d.products} produktów (${d.status})`)} data-testid="pyszne-push-menu">
              <UploadCloud size={14} className="mr-1" /> Wypchnij menu
            </Button>
            <Button variant="outline" className="border-border bg-transparent" disabled={busy} onClick={async () => { const d = await call(() => api.get("/integrations/pyszne/menu-export", { params: { location_id: current.id } })); setMenuPreview(d); }} data-testid="pyszne-preview-menu">
              <Download size={14} className="mr-1" /> Podgląd JSON
            </Button>
          </div>
          {menuPreview && (
            <pre className="text-[10px] leading-relaxed bg-black/40 border border-border rounded p-3 max-h-72 overflow-auto font-mono" data-testid="pyszne-menu-json">{JSON.stringify(menuPreview, null, 2)}</pre>
          )}
        </section>
      </div>

      <section className="border border-border rounded-lg bg-[#12151c] overflow-hidden" data-testid="pyszne-recent">
        <div className="px-6 py-4 border-b border-border font-display font-semibold">Ostatnie zamówienia z agregatora</div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
            <tr><th className="text-left px-6 py-2">#</th><th className="text-left px-6 py-2">Pyszne ID</th><th className="text-left px-6 py-2">Klient</th><th className="text-left px-6 py-2">Status</th><th className="text-right px-6 py-2">Kwota</th><th className="text-right px-6 py-2">Niezmapowane</th></tr>
          </thead>
          <tbody>
            {cfg.recent_orders.map((o) => (
              <tr key={o.id} className="border-t border-border/60" data-testid={`pyszne-order-${o.number}`}>
                <td className="px-6 py-2 font-mono">#{o.number}</td>
                <td className="px-6 py-2 font-mono text-xs">{o.external_id}</td>
                <td className="px-6 py-2">{o.customer_name}</td>
                <td className="px-6 py-2 text-xs">{o.status}</td>
                <td className="px-6 py-2 text-right font-mono">{o.totals?.gross?.toFixed(2)} zł</td>
                <td className={`px-6 py-2 text-right font-mono ${o.unmapped_items ? "text-amber-400" : ""}`}>{o.unmapped_items || 0}</td>
              </tr>
            ))}
            {cfg.recent_orders.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground text-sm">Brak zamówień – wyślij testowe, aby zobaczyć przepływ na KDS.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
