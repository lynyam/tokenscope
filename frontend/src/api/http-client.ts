const API_BASE_URL = "http://localhost:51212/api/v1";

// Pour l'exploration : le token d'Alice, en dur.
// (En vrai, ça viendrait de localStorage après un signIn réel — TSE-43 gérera ça.)
const TEMP_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1NWIyMzRmOS00ZDZhLTRkMjktYTg0Yy1hMDQxNzk2YTZmMjAiLCJpYXQiOjE3OTAwOTU2ODMsImV4cCI6MTc5MDA5OTI4MywiYXVkIjoidG9rZW5zY29wZS13ZWIiLCJpc3MiOiJ0b2tlbnNjb3BlIn0.rdXKeL6Z34VLbB6cQHCFY0YStTNetQEFO7_Q0t5FeIo";

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TEMP_TOKEN}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.message ?? `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}