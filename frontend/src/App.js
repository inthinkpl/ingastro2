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
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <Register />} />
      <Route
        path="/*"
        element={
          <Protected>
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
                </Routes>
              </AppShell>
            </LocationProvider>
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
