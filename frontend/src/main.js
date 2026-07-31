import React from "react"

const button = document.querySelector("#health-check-button");
const status = document.querySelector("#health-status");
const oldStatus = status.textContent;
button.addEventListener("click", async () => {
	status.textContent = "System is checking ...";
	button.disabled = true;
	const response = await fetch("/api/health/db");
	const contentType = response.headers.get("content-type");
	if (!response.ok || !contentType.startsWith("application/json")) {
		console.log("response.status =", response.status.toString());
		status.textContent = oldStatus;
	} else {
		const jsonResponse = await response.json();
		status.textContent = JSON.stringify(jsonResponse);
	}
	button.disabled = false;
});
