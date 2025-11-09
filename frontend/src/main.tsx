import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./providers/AuthProvider";
import { UserSettingsProvider } from "./providers/UserSettingsProvider";
import "./index.css";               // Tailwind
import "@radix-ui/themes/styles.css"; // Radix Themes

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <UserSettingsProvider>
      <App />
    </UserSettingsProvider>
  </AuthProvider>,
);
