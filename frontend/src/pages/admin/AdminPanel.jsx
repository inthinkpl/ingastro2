import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  LayoutDashboard, Boxes, Building2, MessageSquare, LogOut, Save,
  TrendingUp, Users, ShoppingCart, Send, FileText, Download, CheckCircle2,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const money = (v) => `${Number(v || 0).toFixed(2)} zł`;
const thisPeriod = () => new Date().toISOString().slice(0, 7);
const TABS = [
  { key: "overview", label: "Przegląd", icon: LayoutDashboard },
  { key: "modules", label: "Moduły & Ceny", icon: Boxes },
  { key: "tenants", label: "Tenanci", icon: Building2 },
  { key: "invoices", label: "Faktury", icon: FileText },
  { key: "sms", label: "Dziennik SMS", icon: MessageSquare },
];

function Kpi({ icon: Icon, label, value, accent }) {
  return (
    <div className="border border-border bg-[#12151c] rounded-xl p-5" data-testid={`kpi-${label}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        <Icon size={16} className={accent} />
      </div>
      <div className="font-display text-3xl font-semibold mt-3">{value}</div>
    </div>
  );
}

export default function AdminPanel() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [config, setConfig] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [sms, setSms] = useState([]);
  const [saving, setSaving] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [invSummary, setInvSummary] = useState(null);
  const [period, setPeriod] = useState(thisPeriod());
  const [genBusy, setGenBusy] = useState(false);

  const loadAll = async () => {
    const [o, c, t, s] = await Promise.all([
      api.get("/admin/overview"), api.get("/admin/config"),
      api.get("/admin/tenants"), api.get("/admin/sms"),
    ]);
    setOverview(o.data); setConfig(c.data); setTenants(t.data); setSms(s.data);
  };
  useEffect(() => { loadAll().catch(() => {}); }, []);

  const loadInvoices = async () => {
    const [i, sum] = await Promise.all([api.get("/admin/invoices"), api.get("/admin/invoices/summary")]);
    setInvoices(i.data); setInvSummary(sum.data);
  };
  useEffect(() => { if (tab === "invoices") loadInvoices().catch(() => {}); }, [tab]);

  const generateInvoices = async () => {
    setGenBusy(true);
    try {
      await api.post("/admin/invoices/generate", { period });
      await loadInvoices();
      toast.success(`Wygenerowano faktury za ${period}`);
    } catch (e) { toast.error(formatApiError(e?.response?.data?.detail)); }
    finally { setGenBusy(false); }
  };

  const toggleInvoicePaid = async (inv) => {
    try {
      await api.put(`/admin/invoices/${inv.id}`, { status: inv.status === "paid" ? "unpaid" : "paid" });
      await loadInvoices();
    } catch (e) { toast.error(formatApiError(e?.response?.data?.detail)); }
  };

  const downloadPdf = async (inv) => {
    try {
      const { data } = await api.get(`/admin/invoices/${inv.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url; a.download = `${inv.number || inv.id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error("Nie udało się pobrać PDF"); }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/admin/config", {
        modules: config.modules.map((m) => ({ key: m.key, monthly_price: parseFloat(m.monthly_price) || 0, enabled: m.enabled })),
        sms_price: parseFloat(config.sms_price) || 0, sms_enabled: config.sms_enabled,
      });
      setConfig(data);
      toast.success("Zapisano konfigurację platformy");
      loadAll();
    } catch (e) { toast.error(formatApiError(e?.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const toggleTenantModule = async (t, key) => {
    const current = t.modules || {};
    const next = { ...current, [key]: current[key] === false ? true : false };
    try {
      await api.put(`/admin/tenants/${t.id}`, { modules: next });
      setTenants((rows) => rows.map((r) => (r.id === t.id ? { ...r, modules: next } : r)));
    } catch (e) { toast.error(formatApiError(e?.response?.data?.detail)); }
  };

  const toggleTenantActive = async (t) => {
    try {
      await api.put(`/admin/tenants/${t.id}`, { active: !t.active });
      setTenants((rows) => rows.map((r) => (r.id === t.id ? { ...r, active: !r.active } : r)));
    } catch (e) { toast.error(formatApiError(e?.response?.data?.detail)); }
  };

  return (
    <div className="flex h-screen bg-[#0a0c10] text-foreground">
      <aside className="w-60 shrink-0 border-r border-border bg-[#12151c] flex flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-border">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center font-display text-white font-bold">iG</div>
          <div>
            <div className="font-display font-semibold tracking-tight">Platform</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-amber-400">Super Admin</div>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} data-testid={`admin-nav-${t.key}`}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${tab === t.key ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}>
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <div className="px-2 pb-2 text-sm">{user?.email}</div>
          <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={logout} data-testid="admin-logout"><LogOut size={14} className="mr-2" /> Wyloguj</Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        {tab === "overview" && overview && (
          <div className="space-y-6" data-testid="admin-overview">
            <div><div className="text-[10px] uppercase tracking-[0.2em] text-amber-400 mb-2">Platforma SaaS</div><h1 className="font-display text-3xl font-semibold">Przegląd</h1></div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <Kpi icon={Building2} label="Tenanci" value={overview.tenants} accent="text-blue-400" />
              <Kpi icon={Users} label="Użytkownicy" value={overview.users} accent="text-emerald-400" />
              <Kpi icon={ShoppingCart} label="Zamówienia" value={overview.orders} accent="text-purple-400" />
              <Kpi icon={TrendingUp} label="MRR (abonamenty)" value={money(overview.mrr)} accent="text-amber-400" />
              <Kpi icon={Send} label="Wysłane SMS" value={overview.sms_sent} accent="text-cyan-400" />
              <Kpi icon={MessageSquare} label="Przychód SMS" value={money(overview.sms_revenue)} accent="text-pink-400" />
            </div>
          </div>
        )}

        {tab === "modules" && config && (
          <div className="space-y-6 max-w-3xl" data-testid="admin-modules">
            <div><div className="text-[10px] uppercase tracking-[0.2em] text-amber-400 mb-2">Konfiguracja SaaS</div><h1 className="font-display text-3xl font-semibold">Moduły & Ceny</h1><p className="text-sm text-muted-foreground mt-1">Włączaj moduły globalnie i ustal miesięczny abonament dla każdego z nich.</p></div>
            <div className="border border-border bg-[#12151c] rounded-xl divide-y divide-border/50">
              {config.modules.map((m, i) => (
                <div key={m.key} className="flex items-center gap-4 p-4" data-testid={`admin-module-${m.key}`}>
                  <div className="flex-1"><div className="font-medium">{m.label}</div><div className="text-xs text-muted-foreground font-mono">{m.key}</div></div>
                  <div className="flex items-center gap-2">
                    <Input type="number" step="1" value={m.monthly_price} onChange={(e) => setConfig({ ...config, modules: config.modules.map((x, j) => j === i ? { ...x, monthly_price: e.target.value } : x) })} className="w-28 text-right" data-testid={`admin-module-price-${m.key}`} />
                    <span className="text-xs text-muted-foreground w-10">zł/mc</span>
                  </div>
                  <Switch checked={m.enabled} onCheckedChange={(v) => setConfig({ ...config, modules: config.modules.map((x, j) => j === i ? { ...x, enabled: v } : x) })} data-testid={`admin-module-toggle-${m.key}`} />
                </div>
              ))}
            </div>

            <div className="border border-border bg-[#12151c] rounded-xl p-5 space-y-4">
              <h2 className="font-display text-lg font-semibold flex items-center gap-2"><MessageSquare size={16} className="text-amber-400" /> Powiadomienia SMS</h2>
              <div className="flex items-center justify-between">
                <div><div className="text-sm font-medium">Usługa SMS aktywna globalnie</div><div className="text-xs text-muted-foreground">Wyłączenie blokuje SMS u wszystkich tenantów.</div></div>
                <Switch checked={config.sms_enabled} onCheckedChange={(v) => setConfig({ ...config, sms_enabled: v })} data-testid="admin-sms-toggle" />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm">Cena za 1 SMS</span>
                <Input type="number" step="0.01" value={config.sms_price} onChange={(e) => setConfig({ ...config, sms_price: e.target.value })} className="w-28 text-right" data-testid="admin-sms-price" />
                <span className="text-xs text-muted-foreground">zł</span>
              </div>
            </div>
            <Button className="bg-amber-500 hover:bg-amber-400 text-black gap-2" disabled={saving} onClick={saveConfig} data-testid="admin-save-config"><Save size={15} /> Zapisz konfigurację</Button>
          </div>
        )}

        {tab === "tenants" && (
          <div className="space-y-6" data-testid="admin-tenants">
            <div><div className="text-[10px] uppercase tracking-[0.2em] text-amber-400 mb-2">Zarządzanie</div><h1 className="font-display text-3xl font-semibold">Tenanci</h1><p className="text-sm text-muted-foreground mt-1">Włączaj/wyłączaj moduły i konta klientów. Zmiany działają natychmiast w ich aplikacji.</p></div>
            <div className="space-y-3">
              {tenants.map((t) => (
                <div key={t.id} className="border border-border bg-[#12151c] rounded-xl p-5 space-y-3" data-testid={`admin-tenant-${t.slug}`}>
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="font-display text-lg font-semibold">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.owner_email} · plan {t.plan} · {t.orders} zam. · {t.sms_sent} SMS ({money(t.sms_cost)})</div>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className={t.active ? "text-emerald-400" : "text-red-400"}>{t.active ? "Aktywny" : "Zablokowany"}</span>
                      <Switch checked={t.active} onCheckedChange={() => toggleTenantActive(t)} data-testid={`admin-tenant-active-${t.slug}`} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(config?.modules || []).map((m) => {
                      const on = (t.modules || {})[m.key] !== false && m.enabled;
                      const globallyOff = !m.enabled;
                      return (
                        <button key={m.key} disabled={globallyOff} onClick={() => toggleTenantModule(t, m.key)} data-testid={`admin-tenant-mod-${t.slug}-${m.key}`}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${globallyOff ? "opacity-40 border-border text-muted-foreground cursor-not-allowed" : on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-border text-muted-foreground hover:bg-white/5"}`}>
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "invoices" && (
          <div className="space-y-6" data-testid="admin-invoices">
            <div className="flex items-end justify-between flex-wrap gap-4">
              <div><div className="text-[10px] uppercase tracking-[0.2em] text-amber-400 mb-2">Rozliczenia</div><h1 className="font-display text-3xl font-semibold">Faktury SaaS</h1><p className="text-sm text-muted-foreground mt-1">Miesięczny abonament modułów + zużycie SMS, per tenant.</p></div>
              <div className="flex items-end gap-2">
                <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-[160px]" data-testid="invoice-period" />
                <Button className="bg-amber-500 hover:bg-amber-400 text-black gap-2" disabled={genBusy} onClick={generateInvoices} data-testid="invoice-generate"><FileText size={15} /> Generuj faktury</Button>
              </div>
            </div>

            {invSummary && (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <Kpi icon={FileText} label="Należności" value={money(invSummary.outstanding)} accent="text-red-400" />
                <Kpi icon={CheckCircle2} label="Zapłacone" value={money(invSummary.paid)} accent="text-emerald-400" />
                <Kpi icon={TrendingUp} label={`Faktury (${invSummary.unpaid_count} niezapł.)`} value={invSummary.count} accent="text-amber-400" />
              </div>
            )}

            <div className="border border-border bg-[#12151c] rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_110px_120px_90px_110px_190px] text-[11px] uppercase tracking-[0.14em] text-muted-foreground px-5 py-3 border-b border-border">
                <div>Tenant / Nr</div><div>Okres</div><div>Abonament</div><div>SMS</div><div className="text-right">Razem</div><div className="text-right">Status / PDF</div>
              </div>
              {invoices.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">Brak faktur. Wybierz okres i kliknij „Generuj faktury".</div>}
              {invoices.map((inv) => (
                <div key={inv.id} className="grid grid-cols-[1fr_110px_120px_90px_110px_190px] px-5 py-3 text-sm border-b border-border/50 items-center" data-testid={`admin-invoice-${inv.id}`}>
                  <div><div className="font-medium">{inv.tenant_name}</div><div className="text-xs text-muted-foreground font-mono">{inv.number}</div></div>
                  <div className="font-mono text-muted-foreground text-xs">{inv.period}</div>
                  <div className="font-mono text-xs">{money(inv.subtotal_modules)}</div>
                  <div className="font-mono text-xs text-muted-foreground">{inv.sms_count} · {money(inv.sms_cost)}</div>
                  <div className="text-right font-mono text-amber-400">{money(inv.total)}</div>
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => toggleInvoicePaid(inv)} data-testid={`invoice-status-${inv.id}`}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${inv.status === "paid" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`}>
                      {inv.status === "paid" ? "Zapłacona" : "Niezapłacona"}
                    </button>
                    <button onClick={() => downloadPdf(inv)} className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-white/5" data-testid={`invoice-pdf-${inv.id}`}><Download size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "sms" && (
          <div className="space-y-6" data-testid="admin-sms-log">
            <div><div className="text-[10px] uppercase tracking-[0.2em] text-amber-400 mb-2">Monitoring</div><h1 className="font-display text-3xl font-semibold">Dziennik SMS</h1></div>
            <div className="border border-border bg-[#12151c] rounded-xl overflow-hidden">
              <div className="grid grid-cols-[150px_1fr_110px_90px] text-[11px] uppercase tracking-[0.14em] text-muted-foreground px-5 py-3 border-b border-border"><div>Data</div><div>Treść</div><div>Numer</div><div className="text-right">Koszt</div></div>
              {sms.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">Brak wysłanych SMS.</div>}
              {sms.map((m) => (
                <div key={m.id} className="grid grid-cols-[150px_1fr_110px_90px] px-5 py-3 text-sm border-b border-border/50 items-center" data-testid={`admin-sms-${m.id}`}>
                  <div className="text-xs text-muted-foreground">{new Date(m.at).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}</div>
                  <div className="truncate text-xs">{m.body}</div>
                  <div className="font-mono text-xs text-muted-foreground">{m.to}</div>
                  <div className="text-right font-mono text-amber-400">{money(m.cost)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
