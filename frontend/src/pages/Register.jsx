import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", tenant_name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(form);
      toast.success("Konto utworzone");
      navigate("/");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail, "Nie można zarejestrować"));
    } finally {
      setLoading(false);
    }
  };

  const change = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="min-h-screen bg-[#0a0c10] bg-dot grid place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-6 border border-border bg-[#12151c] rounded-lg p-8" data-testid="register-form">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-gradient-to-br from-blue-500 to-blue-700 grid place-items-center font-display font-bold text-white">iG</div>
          <div>
            <div className="font-display font-semibold text-lg tracking-tight">inGastro</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Cloud OS</div>
          </div>
        </div>

        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Zarejestruj restaurację</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Utwórz tenant SaaS – dostaniesz dostęp do POS, KDS i panelu analitycznego.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nazwa restauracji (tenant)</Label>
            <Input value={form.tenant_name} onChange={change("tenant_name")} required data-testid="register-tenant" placeholder="Pizzeria Verona" />
          </div>
          <div className="space-y-1.5">
            <Label>Twoje imię i nazwisko</Label>
            <Input value={form.name} onChange={change("name")} required data-testid="register-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={change("email")} required data-testid="register-email" />
          </div>
          <div className="space-y-1.5">
            <Label>Hasło (min. 6 znaków)</Label>
            <Input type="password" value={form.password} onChange={change("password")} required minLength={6} data-testid="register-password" />
          </div>
        </div>

        <Button type="submit" disabled={loading} className="w-full bg-blue-500 hover:bg-blue-400" data-testid="register-submit">
          {loading ? "Tworzenie…" : "Utwórz konto"}
        </Button>

        <p className="text-sm text-muted-foreground text-center">
          Masz już konto?{" "}
          <Link to="/login" className="text-blue-400 hover:text-blue-300">
            Zaloguj się
          </Link>
        </p>
      </form>
    </div>
  );
}
