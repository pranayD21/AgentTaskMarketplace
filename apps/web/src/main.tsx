import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
import { Landing } from "./Landing";

function Website() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const navigate = () => {
      const next = window.location.hash;
      setHash(next);
      if (!next || next === "#" || next === "#activity") window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  return !hash || hash === "#" || hash === "#intro" ? <Landing /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Website />
  </StrictMode>,
);
