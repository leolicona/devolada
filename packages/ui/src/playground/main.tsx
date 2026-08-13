import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";
import { Showcase } from "./Showcase";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Showcase />
  </StrictMode>,
);
