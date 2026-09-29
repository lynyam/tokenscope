/**
 * Mirrors the backend's ApiErrorResponse shape exactly (see
 * backend/src/common/types/api-error.ts and api-exception.filter.ts).
 * This is what every *.api.ts file's callers (AuthContext, pages) should
 * catch — never a raw fetch Response or a generic Error.
 */
export interface ValidationErrorDetail {
  field: string;
  messages: string[];
}

export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  error: string;
  message: string;
  requestId: string;
  details?: ValidationErrorDetail[];
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly requestId: string;
  public readonly details?: ValidationErrorDetail[];

  constructor(response: ApiErrorResponse) {
    super(response.message);
    this.name = "ApiError";
    this.statusCode = response.statusCode;
    this.code = response.code;
    this.requestId = response.requestId;
    this.details = response.details;
  }
}