import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./features/nft/actions.css";
import "./features/pages.css";
import "./features/miners.css";
import "./features/farms.css";
import "./features/nft/calculator.css";
import "./components/theme-extra.css";
import "./features/restored-sections.css";
import "./features/restored-miners.css";
import "./features/restored-farms.css";
import "./features/restored-sale-ref.css";
import "./features/original-cards.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
