import { HttpStatus, ValidationPipe } from "@nestjs/common";
import type { ValidationError } from "class-validator";
import { ApiException } from "../errors/api.exception";
import type { ValidationErrorDetail } from "../types/api-error";

function toDetails(errors: ValidationError[], parent = "",): ValidationErrorDetail[] {
	return errors.flatMap((error) => {
		const field = [parent, error.property].filter(Boolean).join(".") || "body";

    const messages = Object.values(error.constraints ?? {});
    const own = messages.length > 0 ? [{ field, messages }] : [];

    return [...own, ...toDetails(error.children ?? [], field)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
    validationError: {
      target: false,
      value: false,
    },
    exceptionFactory: (errors: ValidationError[]) =>
      new ApiException(
        HttpStatus.BAD_REQUEST,
        "VALIDATION_ERROR",
        "Request validation failed.",
        toDetails(errors),
      ),
  });
}
