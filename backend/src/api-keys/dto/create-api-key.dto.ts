import { Transform } from "class-transformer";
import { IsString, Length } from "class-validator";

export class CreateApiKeyDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @Length(1, 64)
  name!: string;
}
