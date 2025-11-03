import { useEffect, useState } from "react";
import MapPage from "./pages/MapPage";
import AdminPage from "./pages/AdminPage";
import { Theme } from "@radix-ui/themes";
import { Button } from "@radix-ui/themes";

export default function App() {
  const [tab, setTab] = useState<"map"|"admin">("map");
  useEffect(() => {
    const handler = () => setTab("map");
    window.addEventListener("ingest-smoke-test:completed", handler);
    return () => window.removeEventListener("ingest-smoke-test:completed", handler);
  }, []);
  return (
    <Theme
      appearance="light"     // or "dark"
      accentColor="blue"   // accent color
      grayColor="sand"       // gray palette
      radius="medium"        // border radius
      scaling="100%"         // size scaling
    >
      <div>
        <nav style={{ display:"flex", gap:8, padding:8 }}>
          <Button onClick={()=>setTab("map")}>Map</Button>
          <Button onClick={()=>setTab("admin")}>Admin</Button>
        </nav>
        {tab==="map"? <MapPage/> : <AdminPage/>}
      </div>
    </Theme>
  );
}
