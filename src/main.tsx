import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles.css";
import "./features/nft/actions.css";
import "./features/pages.css";
import "./features/nft/calculator.css";
import "./components/theme-extra.css";
import "./features/legacy.css";
import "./cashx-theme.css";
import "./features/nft/cashx-artwork.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 10 * 60 * 1000,
      retry: 1,
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
