import { IsString, Length, MaxLength, ValidateIf, } from "class-validator";
import { Transform } from "class-transformer";

export class CreateProjectDto {
// Transformation runs before validation. Whitespace alone is invalid.
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() : value,
  )
    @IsString()
    @Length(1, 100)
    name!: string

    // The field may be omitted. A supplied value must be a string.
    // The service stores an empty trimmed string as null.
    @ValidateIf((_object, value) => value !== undefined)
    @Transform(({ value }) => typeof value === "string" ? value.trim() : value,)
    @IsString()
    @MaxLength(2000)
    description?: string | undefined;
}
