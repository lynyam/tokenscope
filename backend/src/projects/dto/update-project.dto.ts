import { IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from "class-transformer"

export class UpdateProjectDto {
    // Omission is allowed; null is not a valid name.
    // IsOptional() for name: it accepts null, which is not a valid name
    @ValidateIf((_object, value) => value !== undefined)
    @Transform(({ value }) => typeof value === "string" ? value.trim() : value,)
    @IsString()
    @Length(1, 100)
    name?: string;

    // API.md explicitly permits null to clear the description.
    @ValidateIf((_object, value) => value !== undefined && value !== null,)
    @Transform(({ value }) => typeof value === "string" ? value.trim() : value,)
    @IsString()
    @MaxLength(2000)
    description?: string | null;
}
