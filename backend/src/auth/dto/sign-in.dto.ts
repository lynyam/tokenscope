import { IsEmail, IsString, Length, MaxLength } from "class-validator";
import { Transform } from "class-transformer";

/**
 * Validation rules for POST /auth/signin.
 */
export class SignInDto {
  /**
   * Must apply the SAME normalization as SignUpDto. If sign-up stored
   * "alice@example.com" but sign-in looked up "Alice@Example.com", the
   * lookup would miss and the user could never authenticate.
   */
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /**
   * Intentionally does NOT repeat sign-up's 8–128 rule. Enforcing the
   * password policy here would let an attacker learn the policy from
   * sign-in validation errors. Credential correctness is decided by
   * auth.service.ts's single generic 401 instead.
   */
  @IsString()
  @Length(1, 128)
  password!: string;
}