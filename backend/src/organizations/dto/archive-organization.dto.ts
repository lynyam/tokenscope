import {IsString, Matches} from 'class-validator';

export class ArchiveOrganizationDto {
    @IsString()
    @Matches(/\S/, { message: "confirmSlug must not be empty or whitespace only" })
    confirmSlug!: string;
}
