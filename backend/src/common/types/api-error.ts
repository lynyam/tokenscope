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
