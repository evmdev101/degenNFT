import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { recoverStalePage } from "./lib/stalePageRecovery";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles.css";
import "./features/nft/actions.css";
import "./features/pages.css";
import "./features/nft/calculator.css";
import "./components/theme-extra.css";
import "./features/legacy.css";
import "./cashx-theme.css";
import "./features/nft/cashx-artwork.css";
import "./components/interface.css";
import "./features/farm-improvements.css";
import "./features/miner-cards.css";
import "./features/dashboard/dashboard.css";
import "./components/theme-picker.css";
import "./components/mobile.css";

window.addEventListener("vite:preloadError", event => {
  if (recoverStalePage((event as Event & { payload: unknown }).payload)) event.preventDefault();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 10 * 60 * 1000,
      retry: 3,
      retryDelay: attempt => Math.min(1000 * 2 ** attempt, 15_000),
      refetchIntervalInBackground: false,
      staleTime: 30 * 1000,
      refetchOnReconnect: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <App />
        </HashRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
