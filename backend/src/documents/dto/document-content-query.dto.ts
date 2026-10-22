import { IsIn, IsOptional } from "class-validator";

export class DocumentContentQuery {
	@IsOptional()
	@IsIn(["true", "false"])
	download?: "true" | "false";
}
