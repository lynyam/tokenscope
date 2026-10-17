import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import specification = require("./public-api.json");

@Controller("public")
export class PublicDocsController {
	@Get("openapi.json")
	@Public()
	document() {
		return specification;
	}
}