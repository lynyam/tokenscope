import { IsEmail, IsString, Length, MaxLength } from "class-validator";
import { Transform } from "class-transformer";

/**
 * Validation rules copied exactly from API.md's
 * POST /auth/signup section.
 *
 * The global ValidationPipe (already configured in configure-app.ts with
 * whitelist + forbidNonWhitelisted) enforces these before the controller
 * method body ever runs, and rejects any undeclared extra field with 400.
 */
export class SignUpDto {
  /**
   * @Transform runs BEFORE the validation decorators, so @IsEmail checks
   * the already-normalized value, and auth.service.ts receives an email
   * that is ready for lookup/persistence.
   * API.md: "valid email, trimmed, lowercased before lookup/persistence,
   * maximum 254 characters".
   */
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /**
   * Deliberately NOT transformed. API.md is explicit: "it is not trimmed
   * or normalized." A password's leading/trailing spaces are meaningful
   * characters the user chose.
   */
  @IsString()
  @Length(8, 128)
  password!: string;

  /** API.md: "trimmed, 1–80 characters". */
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 80)
  displayName!: string;
}