import { Link, useLocation as useRouterLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Receipt,
  Flame,
  ListOrdered,
  BookOpenText,
  Building2,
  Grid3x3,
  Users,
  LogOut,
  ChevronDown,
  Store,
  Package,
  Globe,
  Plug,
  Clock,
  Truck,
  ExternalLink,
  MapPin,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "@/contexts/LocationContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/pos", label: "Kasa POS", icon: Receipt, testid: "nav-pos", mod: "pos" },
  { to: "/kds", label: "KDS Kuchnia", icon: Flame, testid: "nav-kds", mod: "kds" },
  { to: "/orders", label: "Zamówienia", icon: ListOrdered, testid: "nav-orders" },
  { to: "/menu", label: "Menu", icon: BookOpenText, testid: "nav-menu" },
  { to: "/tables", label: "Stoliki", icon: Grid3x3, testid: "nav-tables" },
  { to: "/locations", label: "Lokale", icon: Building2, testid: "nav-locations" },
  { to: "/employees", label: "Personel", icon: Users, testid: "nav-employees" },
  { to: "/rcp", label: "RCP Czas pracy", icon: Clock, testid: "nav-rcp", mod: "rcp" },
  { to: "/dispatch", label: "Dyspozytornia", icon: MapPin, testid: "nav-dispatch", mod: "courier" },
  { to: "/inventory", label: "Magazyn BOM", icon: Package, testid: "nav-inventory", mod: "inventory" },
  { to: "/store-settings", label: "Sklep online", icon: Globe, testid: "nav-store-settings", mod: "ecommerce" },
  { to: "/integrations", label: "Integracje", icon: Plug, testid: "nav-integrations", mod: "pyszne" },
];

export default function AppShell({ children }) {
  const { user, tenant, logout } = useAuth();
  const { locations, current, selectLocation } = useLocation();
  const router = useRouterLocation();
  const navigate = useNavigate();
  const mods = tenant?.modules || {};
  const navItems = NAV.filter((n) => !n.mod || mods[n.mod] !== false);
  const courierEnabled = mods.courier !== false;

  return (
    <div className="flex h-screen bg-[#0a0c10] text-foreground">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-border bg-[#12151c] flex flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-border">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-blue-500 to-blue-700 grid place-items-center font-display text-white font-bold">
            iG
          </div>
          <div>
            <div className="font-display font-semibold tracking-tight">inGastro</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Cloud OS</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((n) => {
            const Active = router.pathname === n.to || (n.to !== "/" && router.pathname.startsWith(n.to));
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                data-testid={n.testid}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  Active
                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <Icon size={16} />
                <span>{n.label}</span>
              </Link>
            );
          })}
          {courierEnabled && tenant?.slug && (
            <a
              href={`/c/${tenant.slug}`}
              target="_blank"
              rel="noreferrer"
              data-testid="nav-courier"
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <Truck size={16} />
              <span className="flex-1">Aplikacja Kuriera</span>
              <ExternalLink size={12} className="opacity-50" />
            </a>
          )}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground px-2 pb-2">
            Tenant
          </div>
          <div className="px-2 pb-3">
            <div className="text-sm font-medium" data-testid="tenant-name">{tenant?.name}</div>
            <div className="text-xs text-muted-foreground">{tenant?.plan?.toUpperCase()}</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 shrink-0 border-b border-border bg-[#12151c]/90 backdrop-blur px-5 flex items-center justify-between">
          {/* Location switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2 border-border bg-transparent hover:bg-white/5" data-testid="location-switcher">
                <Store size={14} />
                <span className="font-medium">{current?.name || "Wybierz lokal"}</span>
                <ChevronDown size={14} className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[260px]">
              <DropdownMenuLabel>Lokale</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {locations.map((l) => (
                <DropdownMenuItem
                  key={l.id}
                  onClick={() => selectLocation(l)}
                  data-testid={`location-option-${l.id}`}
                >
                  <div className="flex flex-col">
                    <span className="text-sm">{l.name}</span>
                    <span className="text-xs text-muted-foreground">{l.city}</span>
                  </div>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/locations")}>
                + Dodaj lokal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors"
                data-testid="user-menu-trigger"
              >
                <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/40 grid place-items-center text-sm font-medium text-blue-300">
                  {(user?.name || "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium">{user?.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">{user?.role}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} data-testid="logout-btn">
                <LogOut size={14} className="mr-2" /> Wyloguj
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
