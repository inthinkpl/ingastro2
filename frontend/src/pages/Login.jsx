import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("demo@savona.pl");
  const [password, setPassword] = useState("demo1234");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail, "Nie można się zalogować"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0c10] bg-dot text-foreground flex">
      <div className="hidden lg:flex flex-col w-1/2 p-14 bg-gradient-to-br from-blue-950/60 via-[#0a0c10] to-[#0a0c10] border-r border-border relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-gradient-to-br from-blue-500 to-blue-700 grid place-items-center font-display font-bold text-white">iG</div>
          <div>
            <div className="font-display font-semibold text-lg tracking-tight">inGastro</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Cloud OS</div>
          </div>
        </div>
        <div className="mt-auto">
          <h1 className="font-display text-4xl xl:text-5xl font-semibold leading-tight tracking-tight">
            Multi-Tenant ERP<br />
            dla restauracji,<br />
            <span className="text-blue-400">zbudowany na szybkość.</span>
          </h1>
          <p className="mt-6 text-muted-foreground max-w-md">
            Kasa POS, Kuchnia KDS w czasie rzeczywistym, zamówienia online, magazyn BOM
            oraz program lojalnościowy – wszystko w jednym systemie SaaS.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4 max-w-md">
            {[
              ["POS", "Kasa dotykowa"],
              ["KDS", "Bezpapierowa kuchnia"],
              ["RCP", "Czas pracy"],
            ].map(([k, v]) => (
              <div key={k} className="border border-border/60 bg-white/[0.02] p-3 rounded">
                <div className="font-mono text-xs text-blue-400">{k}</div>
                <div className="text-xs text-muted-foreground mt-1">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 grid place-items-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" data-testid="login-form">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.2em] text-blue-400">Zaloguj się</div>
            <h2 className="font-display text-3xl font-semibold tracking-tight">Witaj z powrotem.</h2>
            <p className="text-sm text-muted-foreground">Konto demo wypełnione – kliknij Zaloguj.</p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="login-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Hasło</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="login-password"
              />
            </div>
          </div>

          <Button type="submit" disabled={loading} className="w-full bg-blue-500 hover:bg-blue-400" data-testid="login-submit">
            {loading ? "Logowanie…" : "Zaloguj się"}
          </Button>

          <p className="text-sm text-muted-foreground text-center">
            Nie masz konta?{" "}
            <Link to="/register" className="text-blue-400 hover:text-blue-300" data-testid="link-register">
              Zarejestruj restaurację
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
