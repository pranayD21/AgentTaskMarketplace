import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { Landing } from "../../web/src/Landing";

function WorkspaceEntry() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const navigate = () => setHash(window.location.hash);
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  if (window.location.pathname === "/task.html" || hash === "#workspace") return <App />;
  return <Landing destination="#workspace" action="Open workspace" navLabel="Workspace" />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkspaceEntry />
  </StrictMode>,
);
