import { useEffect, useState } from "react";
import { listDevices, type DeviceSummary } from "../lib/api";
export default function AdminPage() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  useEffect(()=>{ listDevices().then(setDevices).catch(()=>setDevices([])); },[]);
  return (
    <div style={{ padding:12 }}>
      <h2>Admin</h2>
      <table><thead><tr><th>ID</th><th>Name</th><th>Status</th></tr></thead>
      <tbody>{devices.map(d=><tr key={d.id}><td>{d.id}</td><td>{d.name}</td><td>{d.status}</td></tr>)}</tbody></table>
    </div>
  );
}
