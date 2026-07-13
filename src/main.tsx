import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./features/nft/actions.css";
import "./features/pages.css";
import "./features/nft/calculator.css";
import "./components/theme-extra.css";
import "./features/legacy.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
