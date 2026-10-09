import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const LocationContext = createContext(null);

export function LocationProvider({ children }) {
  const { user } = useAuth();
  const [locations, setLocations] = useState([]);
  const [current, setCurrent] = useState(null);

  const reload = useCallback(async () => {
    if (!user) return;
    const { data } = await api.get("/locations");
    setLocations(data);
    const saved = localStorage.getItem("ig_location");
    const found = data.find((l) => l.id === saved) || data[0] || null;
    setCurrent(found);
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectLocation = (loc) => {
    setCurrent(loc);
    if (loc) localStorage.setItem("ig_location", loc.id);
  };

  return (
    <LocationContext.Provider value={{ locations, current, selectLocation, reload }}>
      {children}
    </LocationContext.Provider>
  );
}

export const useLocation = () => useContext(LocationContext);
