const API_BASE_URL = "/api/v1";
const ACCESS_TOKEN_STORAGE_KEY = "access_token";

export interface ApiErrorDetail {
    field: string;
    messages: string[];
}

export class ApiError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
        public readonly details?: ApiErrorDetail[],
        public readonly requestId?: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

function getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = getAccessToken();
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
    });

    if (response.status === 204) {
        return undefined as T;
    }

    const body = await response.json().catch(() => null);

    if (!response.ok) {
        throw new ApiError(
            body?.statusCode ?? response.status,
            body?.code ?? "HTTP_ERROR",
            body?.message ?? "An unexpected error occurred.",
            body?.details,
            body?.requestId,
        );
    }

    return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
    return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, {
        method: "POST",
        body: data !== undefined ? JSON.stringify(data) : undefined,
    });
}

export function apiPatch<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, {
        method: "PATCH",
        body: data !== undefined ? JSON.stringify(data) : undefined,
    });
}

export function apiDelete<T = void>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
}