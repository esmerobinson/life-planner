import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./ui/AppShell";
import { NAV } from "./ui/areas";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {NAV.map((n) => (
            <Route key={n.id} path={n.path} element={<h1>{n.label}</h1>} />
          ))}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
