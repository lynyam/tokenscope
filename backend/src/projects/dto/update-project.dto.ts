import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class UpdateProjectDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    name?: string;

    @IsOptional()
    @IsString()
    description?: string | undefined;
}