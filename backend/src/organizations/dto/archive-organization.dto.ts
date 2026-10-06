import {IsString, Matches} from 'class-validator';

const MAX_TRANSACTION_ATTEMPTS = 3; // en haut, hors de la classe

export class ArchiveOrganizationDto {
    @IsString()
    @Matches(/\S/, { message: "confirmSlug must not be empty or whitespace only" })
    confirmSlug!: string;
}
