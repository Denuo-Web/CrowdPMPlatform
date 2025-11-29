import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./providers/AuthProvider";
import { UserSettingsProvider } from "./providers/UserSettingsProvider";
import "./index.css";               // Tailwind
import "@radix-ui/themes/styles.css"; // Radix Themes
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
    },
  },
});

declare global {
  interface Window {
    __TANSTACK_QUERY_CLIENT__?: QueryClient;
  }
}

if (import.meta.env.DEV) {
  window.__TANSTACK_QUERY_CLIENT__ = queryClient;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UserSettingsProvider>
          <App />
        </UserSettingsProvider>
      </AuthProvider>
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  </React.StrictMode>
);
