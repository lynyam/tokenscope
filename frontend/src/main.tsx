import React from "react";
import ReactDOM from "react-dom/client";
import { AppRouter } from "./router/AppRouter";
export {}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
);
import { signIn } from "./api/auth.api";

await signIn({ email: "alic@tokenscope.dev", password: "password123" });

/*export {}
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
*/
