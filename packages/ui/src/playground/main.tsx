import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";
import { Muestra } from "./Muestra";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Muestra />
  </StrictMode>,
);
