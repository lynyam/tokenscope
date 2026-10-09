import { HttpStatus, Param } from "@nestjs/common";
import type { PipeTransform } from "@nestjs/common";
import { isUUID } from "class-validator";
import { ApiException } from "../errors/api.exception";

export function UuidParam(name: string): ParameterDecorator {
	const pipe: PipeTransform<unknown, string> = {
		transform(value: unknown): string {
			if (typeof value !== "string" || value.length !== 36 || !isUUID(value, "all")) {
				throw new ApiException(
					HttpStatus.BAD_REQUEST,
					"VALIDATION_ERROR",
					"Request validation failed.",
					[{ field: name, messages: [name + " must be a UUID"] }],
				);
			}
			return value;
		},
	};
	return Param(name, pipe);
}
