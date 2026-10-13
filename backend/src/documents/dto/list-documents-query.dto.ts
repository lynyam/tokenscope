import { Transform } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

// Only plain decimal digits become numbers; anything else fails IsInt.
const digitsToNumber = ({ value }: { value: unknown }) =>
	typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : value;

export class ListDocumentsQuery {
	@IsOptional()
	@Transform(digitsToNumber)
	@IsInt()
	@Min(1)
	@Max(100_000)
	page?: number;

	@IsOptional()
	@Transform(digitsToNumber)
	@IsInt()
	@Min(1)
	@Max(100)
	pageSize?: number;
}
