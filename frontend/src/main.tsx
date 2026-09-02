import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider } from "./context/AuthContext";
import { AppRouter } from "./router/AppRouter";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
     <AuthProvider>
      <AppRouter />
     </AuthProvider>
  </React.StrictMode>
);
