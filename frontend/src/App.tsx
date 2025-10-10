import { useState } from "react";
import MapPage from "./pages/MapPage";
import AdminPage from "./pages/AdminPage";
export default function App() {
  const [tab, setTab] = useState<"map"|"admin">("map");
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
