import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Copy, CreditCard, Globe, Package, MessageSquare } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

function Section({ icon: Icon, title, children, testid }) {
  return (
    <section className="border border-border rounded-lg bg-[#12151c] p-6 space-y-4" data-testid={testid}>
      <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Icon size={16} className="text-blue-400" />{title}</h2>
      {children}
    </section>
  );
}

export default function StoreSettings() {
  const [s, setS] = useState(null);
  const [payu, setPayu] = useState({ pos_id: "", md5_second_key: "", client_id: "", client_secret: "", sandbox: true });
  const [saving, setSaving] = useState(false);
  const [sms, setSms] = useState(null);

  const load = async () => {
    const { data } = await api.get("/settings");
    setS(data);
  };
  const loadSms = async () => {
    const { data } = await api.get("/sms/settings");
    setSms(data);
  };
  useEffect(() => {
    load();
    loadSms();
  }, []);

  const toggleSms = async (v) => {
    try {
      const { data } = await api.put("/sms/settings", { enabled: v });
      setSms(data);
      toast.success(v ? "Powiadomienia SMS włączone" : "Powiadomienia SMS wyłączone");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const save = async (patch) => {
    setSaving(true);
    try {
      const { data } = await api.put("/settings", patch);
      setS(data);
      toast.success("Zapisano ustawienia");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  if (!s) return <div className="p-8 text-sm text-muted-foreground">Ładowanie…</div>;
  const storeUrl = `${window.location.origin}/s/${s.slug}`;

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <PageHeader eyebrow="E-Commerce" title="Sklep online" description="Publiczna strona zamówień Twojego tenanta – ścieżka /s/{slug} lub własna subdomena." />

      <Section icon={Globe} title="Adres i widoczność" testid="store-section-general">
        <div className="flex items-center justify-between border border-border rounded-md px-4 py-3">
          <div>
            <div className="text-sm font-medium">Zamówienia online włączone</div>
            <div className="text-xs text-muted-foreground">Wyłączenie ukrywa sklep i blokuje nowe zamówienia.</div>
          </div>
          <Switch checked={s.online_ordering_enabled} onCheckedChange={(v) => save({ online_ordering_enabled: v })} data-testid="toggle-online-ordering" />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Slug sklepu</Label>
            <Input value={s.slug} onChange={(e) => setS({ ...s, slug: e.target.value })} data-testid="store-slug" />
          </div>
          <div className="space-y-1.5">
            <Label>Własna subdomena (opcjonalnie)</Label>
            <Input placeholder="savona.twojadomena.pl" value={s.store_domain} onChange={(e) => setS({ ...s, store_domain: e.target.value })} data-testid="store-domain" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Opis na stronie sklepu</Label>
          <Textarea value={s.store_description} onChange={(e) => setS({ ...s, store_description: e.target.value })} data-testid="store-description" />
        </div>
        <div className="flex items-center gap-3 border border-blue-500/20 bg-blue-500/5 rounded-md px-4 py-3">
          <code className="text-xs text-blue-300 flex-1 truncate" data-testid="store-url">{storeUrl}</code>
          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(storeUrl); toast.success("Skopiowano"); }}><Copy size={14} /></Button>
          <a href={storeUrl} target="_blank" rel="noreferrer" className="text-xs flex items-center gap-1 text-blue-400 hover:text-blue-300" data-testid="open-store-link">Otwórz <ExternalLink size={12} /></a>
        </div>
        <Button className="bg-blue-500 hover:bg-blue-400" disabled={saving} onClick={() => save({ slug: s.slug, store_domain: s.store_domain, store_description: s.store_description })} data-testid="save-general">Zapisz</Button>
      </Section>

      <Section icon={CreditCard} title="Płatności i dostawa" testid="store-section-payments">
        <div className="grid grid-cols-2 gap-3">
          {[["stripe", "Stripe", "Karty, BLIK, Przelewy24 – gotowe od razu"], ["payu", "PayU", s.payu.configured ? `POS ${s.payu.pos_id}` : "Wymaga danych z panelu PayU"]].map(([k, l, d]) => (
            <button key={k} onClick={() => save({ payment_provider: k })} className={`text-left border rounded-md p-4 transition-colors ${s.payment_provider === k ? "border-blue-500 bg-blue-500/10" : "border-border hover:border-blue-500/40"}`} data-testid={`provider-${k}`}>
              <div className="font-medium">{l}</div>
              <div className="text-xs text-muted-foreground mt-1">{d}</div>
            </button>
          ))}
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-1.5"><Label>Koszt dostawy (zł)</Label><Input type="number" step="0.5" value={s.delivery_fee} onChange={(e) => setS({ ...s, delivery_fee: e.target.value })} data-testid="delivery-fee" /></div>
          <div className="space-y-1.5"><Label>Minimalne zamówienie (zł)</Label><Input type="number" step="1" value={s.min_order} onChange={(e) => setS({ ...s, min_order: e.target.value })} data-testid="min-order" /></div>
          <div className="flex items-end justify-between border border-border rounded-md px-4 py-2.5">
            <span className="text-sm">Gotówka przy odbiorze</span>
            <Switch checked={s.accept_cash} onCheckedChange={(v) => save({ accept_cash: v })} data-testid="toggle-cash" />
          </div>
        </div>
        <Button className="bg-blue-500 hover:bg-blue-400" disabled={saving} onClick={() => save({ delivery_fee: parseFloat(s.delivery_fee) || 0, min_order: parseFloat(s.min_order) || 0 })} data-testid="save-payments">Zapisz</Button>

        <div className="border-t border-border pt-4 space-y-3">
          <div className="text-sm font-medium">Dane dostępowe PayU {s.payu.configured && <span className="ml-2 text-xs text-emerald-400">skonfigurowane</span>}</div>
          <div className="grid md:grid-cols-2 gap-3">
            {[["pos_id", "POS ID"], ["md5_second_key", "Drugi klucz (MD5)"], ["client_id", "OAuth client_id"], ["client_secret", "OAuth client_secret"]].map(([k, l]) => (
              <div key={k} className="space-y-1.5"><Label>{l}</Label><Input type={k.includes("secret") || k.includes("md5") ? "password" : "text"} value={payu[k]} onChange={(e) => setPayu({ ...payu, [k]: e.target.value })} autoComplete="new-password" data-testid={`payu-${k}`} /></div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={payu.sandbox} onCheckedChange={(v) => setPayu({ ...payu, sandbox: v })} data-testid="payu-sandbox" /><span className="text-sm">Sandbox (secure.snd.payu.com)</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="border-border bg-transparent" disabled={saving || !payu.pos_id} onClick={async () => { await save({ payu }); setPayu({ pos_id: "", md5_second_key: "", client_id: "", client_secret: "", sandbox: true }); }} data-testid="save-payu">Zapisz PayU</Button>
            {s.payu.configured && <Button variant="ghost" className="text-red-400" onClick={() => save({ clear_payu: true, payment_provider: "stripe" })} data-testid="clear-payu">Usuń dane PayU</Button>}
          </div>
        </div>
      </Section>

      <Section icon={Package} title="Magazyn – moment zdjęcia ze stanu" testid="store-section-stock">
        <div className="grid grid-cols-2 gap-3">
          {[["on_create", "Przy utworzeniu zamówienia", "POS / sklep / Pyszne.pl – natychmiast"], ["on_ready", "Gdy kuchnia oznaczy „Gotowe”", "Zdjęcie ze stanu po wydaniu z KDS"]].map(([k, l, d]) => (
            <button key={k} onClick={() => save({ stock_deduction_mode: k })} className={`text-left border rounded-md p-4 transition-colors ${s.stock_deduction_mode === k ? "border-blue-500 bg-blue-500/10" : "border-border hover:border-blue-500/40"}`} data-testid={`deduction-${k}`}>
              <div className="font-medium">{l}</div>
              <div className="text-xs text-muted-foreground mt-1">{d}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Anulowanie zamówienia zawsze zwraca składniki na stan.</p>
      </Section>

      {sms && (
        <Section icon={MessageSquare} title="Powiadomienia SMS dla klientów" testid="store-section-sms">
          <div className="flex items-center justify-between border border-border rounded-md px-4 py-3">
            <div>
              <div className="text-sm font-medium">SMS „Kurier w drodze"</div>
              <div className="text-xs text-muted-foreground">
                Gdy kurier wyrusza w trasę, klient dostaje SMS.
                {sms.platform_enabled
                  ? ` Płatna usługa: ${Number(sms.price).toFixed(2)} zł za każdy SMS.`
                  : " Usługa chwilowo niedostępna (wyłączona przez operatora)."}
              </div>
            </div>
            <Switch checked={sms.tenant_enabled} disabled={!sms.platform_enabled} onCheckedChange={toggleSms} data-testid="toggle-sms" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-border rounded-md px-4 py-3">
              <div className="text-xs text-muted-foreground">Wysłane SMS</div>
              <div className="font-display text-xl font-semibold" data-testid="sms-sent-total">{sms.sent_total}</div>
            </div>
            <div className="border border-border rounded-md px-4 py-3">
              <div className="text-xs text-muted-foreground">Koszt łącznie</div>
              <div className="font-display text-xl font-semibold text-blue-400" data-testid="sms-cost-total">{Number(sms.cost_total).toFixed(2)} zł</div>
            </div>
          </div>
          {sms.recent?.length > 0 && (
            <div className="border border-border rounded-md divide-y divide-border/50">
              {sms.recent.slice(0, 5).map((m) => (
                <div key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs" data-testid={`sms-log-${m.id}`}>
                  <span className="text-muted-foreground font-mono">{m.to}</span>
                  <span className="flex-1 truncate">{m.body}</span>
                  <span className="text-muted-foreground">{new Date(m.at).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
