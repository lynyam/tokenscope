/**
 * AskAssistantDto + nested 
 * AssistantFiltersDto: question, 
 * ISO-UTC dates, filters, unknown-field rejection
 */

// class-transformer: reshapes incoming JSON into a DTO instance BEFORE validation.
import { Transform, Type } from "class-transformer";
// class-validator: declarative rules checked by the global ValidationPipe.
import {
	IsDefined,
	IsIn,
	IsISO8601,
	IsObject,
	IsString,
	Length,
	Matches,
	MaxLength,
	Validate,
	ValidateIf,
	ValidateNested,
	ValidationArguments,
	ValidatorConstraint,
	ValidatorConstraintInterface,
} from "class-validator";
import { ASSISTANT_LIMITS } from "../assistant.types";

/**
 * Objective: validate the assistant request before any database or provider work.
 * Sub functionalities:
 *  + question: trimmed, 1–2000 characters.
 *  + from/to: strict ISO instants ending in Z, from < to, at most 90 days apart.
 *  + filters: required object; {} = no filtering. Unknown keys (top-level AND
 *    nested) are rejected by the global pipe's forbidNonWhitelisted.
 * Note: TSE-69 owns shared filter normalization. Until merged, this keeps a
 *       minimal equivalent — replace with the shared helpers (TODO TSE-69).
 */

/** Trims strings; an empty string means "filter absent". Non-strings pass through and fail @IsString. */
const trimToUndefined = ({ value }: { value: unknown }): unknown =>
	typeof value === "string" ? value.trim() || undefined : value;

const trim = ({ value }: { value: unknown }): unknown => (typeof value === "string" ? value.trim() : value);

/** Validate only when the key is present, so `null` is REJECTED instead of meaning "absent". */
const isPresent = (_object: object, value: unknown): boolean => value !== undefined;

// strict: rejects impossible dates like Feb 30. strictSeparator: requires the "T".
const STRICT_ISO = { strict: true, strictSeparator: true } as const;
const ENDS_WITH_Z = /Z$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Custom cross-field rule: needs BOTH dates, so it cannot be a single-field decorator.
 * @ValidatorConstraint registers this class as a reusable rule named "assistantDateRange".
 */
@ValidatorConstraint({ name: "assistantDateRange" })
class AssistantDateRange implements ValidatorConstraintInterface {
	/** args.object = the whole DTO being validated, giving access to `from`. */
	validate(to: unknown, args: ValidationArguments): boolean {
		const from = (args.object as { from?: unknown }).from;
		if (typeof from !== "string" || typeof to !== "string") return true; // other rules report it
		const fromMs = Date.parse(from); // ISO string → milliseconds (NaN if invalid)
		const toMs = Date.parse(to);
		if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return true;
		return fromMs < toMs && toMs - fromMs <= ASSISTANT_LIMITS.maxIntervalDays * DAY_MS;
	}

	defaultMessage(): string {
		return `to must be after from and at most ${ASSISTANT_LIMITS.maxIntervalDays} days later`;
	}
}
/*From section 5 of ticket tse-71*/
export class AssistantFiltersDto {
	@ValidateIf(isPresent) // run the rules below only if the key was sent
	@Transform(trimToUndefined) // modify the value before validation
	@IsString() // must be a string (rejects arrays/objects/numbers)
	@MaxLength(100) // at most 100 characters
	q?: string;

	@ValidateIf(isPresent)
	@Transform(trimToUndefined)
	@IsString()
	@MaxLength(40)
	provider?: string;

	@ValidateIf(isPresent)
	@Transform(trimToUndefined)
	@IsString()
	@MaxLength(100)
	model?: string;

	/** Case-sensitive: trimmed only, never lower-cased. */
	@ValidateIf(isPresent)
	@Transform(trimToUndefined)
	@IsString()
	@MaxLength(80)
	workflow?: string;

	@ValidateIf(isPresent)
	@IsIn(["SUCCESS", "ERROR"]) // value must be one of the listed options
	status?: "SUCCESS" | "ERROR";
}
/*From section 5 of ticket tse-80*/
export class AskAssistantDto {
	@Transform(trim)
	@IsString()
	@Length(1, ASSISTANT_LIMITS.questionMaxChars) // min and max length
	question!: string;

	@IsString()
	@IsISO8601(STRICT_ISO) // valid ISO 8601 date-time
	@Matches(ENDS_WITH_Z, { message: "from must be a UTC instant ending in Z" }) // regex check
	from!: string;

	@IsString()
	@IsISO8601(STRICT_ISO)
	@Matches(ENDS_WITH_Z, { message: "to must be a UTC instant ending in Z" })
	@Validate(AssistantDateRange) // apply the custom cross-field rule
	to!: string;

	@IsDefined() // must be present (not undefined/null)
	@IsObject() // must be an object
	@ValidateNested() // validate the inner object's own rules
	@Type(() => AssistantFiltersDto) // tells class-transformer which class to build
	filters!: AssistantFiltersDto;
}

