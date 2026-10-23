import React from "react";
import ReactDOM from "react-dom/client";
import { AppRouter } from "./router/AppRouter";
import "./index.css";
import { ThemeProvider } from "next-themes";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AppRouter />
    </ThemeProvider>
  </React.StrictMode>
);