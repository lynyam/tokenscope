import { HttpException, HttpStatus } from "@nestjs/common";
import { ValidationErrorDetail } from "../types/api-error";

export class ApiException extends HttpException {
	constructor(
		status: HttpStatus,
		public readonly code: string,
		public readonly publicMessage: string,
		public readonly details?: ValidationErrorDetail[],
	) {
		super(publicMessage, status);
	}
}
