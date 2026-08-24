export {}
const button = document.querySelector<HTMLButtonElement>("#health-check-button");
const status = document.querySelector<HTMLElement>("#health-status");

if (!button || !status) {
  throw new Error("Health check elements not found");
}

const oldStatus = status.textContent;

button.addEventListener("click", async () => {
  status.textContent = "System is checking ;) ...";
  button.disabled = true;

  try {
    const response = await fetch("/api/health/db");
    const contentType = response.headers.get("content-type");

    if (
      !response.ok ||
      !contentType?.startsWith("application/json")
    ) {
      console.log("response.status =", response.status.toString());
      status.textContent = oldStatus;
      return;
    }

    const jsonResponse = await response.json();
    status.textContent = JSON.stringify(jsonResponse);
  } finally {
    button.disabled = false;
  }
});

import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { OrganizationsPage } from "./pages/organizations/OrganizationsPage";
import { OrganizationDetailPage } from "./pages/organizations/OrganizationDetailPage";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}
createRoot(rootElement).render(
  <BrowserRouter>
    <Routes>
      <Route path="/organizations" element={<OrganizationsPage />} />
      <Route path="/organizations/:organizationId" element={<OrganizationDetailPage />} />
    </Routes>
  </BrowserRouter>
);

// import { signIn } from "./api/auth.api";

// await signIn({ email: "bob@tokenscope.dev", password: "password123" });
