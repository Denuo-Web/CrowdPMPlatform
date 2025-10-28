import { useEffect, useState } from "react";
import MapPage from "./pages/MapPage";
import AdminPage from "./pages/AdminPage";
export default function App() {
  const [tab, setTab] = useState<"map"|"admin">("map");
  useEffect(() => {
    const handler = () => setTab("map");
    window.addEventListener("ingest-smoke-test:completed", handler);
    return () => window.removeEventListener("ingest-smoke-test:completed", handler);
  }, []);
  return (
    <div>
      <nav style={{ display:"flex", gap:8, padding:8 }}>
        <button onClick={()=>setTab("map")}>Map</button>
        <button onClick={()=>setTab("admin")}>Admin</button>
      </nav>
      {tab==="map"? <MapPage/> : <AdminPage/>}
    </div>
  );
}
