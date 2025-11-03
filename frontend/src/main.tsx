import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Theme } from "@radix-ui/themes";
import "./index.css";               // Tailwind
// import "@radix-ui/themes/styles.css"; // Radix Themes
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
