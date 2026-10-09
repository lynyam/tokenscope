import {IsString, Length} from 'class-validator';
import { Transform } from "class-transformer";

export class CreateOrganizationDto {
    @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
    @IsString()
    @Length(1, 100)
    name!: string;
}
