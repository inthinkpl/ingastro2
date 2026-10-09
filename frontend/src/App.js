import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import "@/App.css";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LocationProvider } from "@/contexts/LocationContext";
import AppShell from "@/components/AppShell";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import POS from "@/pages/POS";
import KDS from "@/pages/KDS";
import Orders from "@/pages/Orders";
import OrderDetail from "@/pages/OrderDetail";
import Menu from "@/pages/Menu";
import Locations from "@/pages/Locations";
import Tables from "@/pages/Tables";
import Employees from "@/pages/Employees";
import Inventory from "@/pages/Inventory";
import StoreSettings from "@/pages/StoreSettings";
import Integrations from "@/pages/Integrations";
import RCP from "@/pages/RCP";
import Dispatch from "@/pages/Dispatch";
import Store from "@/pages/store/Store";
import StorePayment from "@/pages/store/StorePayment";
import StoreOrder from "@/pages/store/StoreOrder";
import CourierPortal from "@/pages/courier/CourierPortal";
import AdminPanel from "@/pages/admin/AdminPanel";
import { detectStoreSlug } from "@/lib/store";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="h-screen grid place-items-center text-sm text-muted-foreground">
        Ładowanie…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  const subSlug = detectStoreSlug();
  return (
    <Routes>
      <Route path="/s/:slug" element={<Store />} />
      <Route path="/s/:slug/payment/:result" element={<StorePayment />} />
      <Route path="/s/:slug/order/:oid" element={<StoreOrder />} />
      <Route path="/c/:slug" element={<CourierPortal />} />
      {subSlug && <Route path="/" element={<Navigate to={`/s/${subSlug}`} replace />} />}
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <Register />} />
      <Route
        path="/*"
        element={
          <Protected>
            {user?.role === "superadmin" ? (
              <AdminPanel />
            ) : (
              <LocationProvider>
                <AppShell>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/pos" element={<POS />} />
                    <Route path="/kds" element={<KDS />} />
                    <Route path="/orders" element={<Orders />} />
                    <Route path="/orders/:oid" element={<OrderDetail />} />
                    <Route path="/menu" element={<Menu />} />
                    <Route path="/locations" element={<Locations />} />
                    <Route path="/tables" element={<Tables />} />
                    <Route path="/employees" element={<Employees />} />
                    <Route path="/inventory" element={<Inventory />} />
                    <Route path="/rcp" element={<RCP />} />
                    <Route path="/dispatch" element={<Dispatch />} />
                    <Route path="/store-settings" element={<StoreSettings />} />
                    <Route path="/integrations" element={<Integrations />} />
                  </Routes>
                </AppShell>
              </LocationProvider>
            )}
          </Protected>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App dark">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
      <Toaster theme="dark" position="top-right" richColors />
    </div>
  );
}
