import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	HttpStatus,
	Post,
  } from "@nestjs/common";
  import { CurrentUser } from "../common/decorators/current-user.decorator";
  import { UuidParam } from "../common/decorators/uuid-param.decorators";
  import type { AuthenticatedUser } from "../common/types/authenticated-user";
  import { ApiKeysService } from "./api-keys.service";
  import { CreateApiKeyDto } from "./dto/create-api-key.dto";

  @Controller(
	"organizations/:organizationId/projects/:projectId/api-keys",
  )
  export class ApiKeysController {
	constructor(private readonly apiKeys: ApiKeysService) {}

	@Post()
	@Header("Cache-Control", "no-store")
	create(
	  @CurrentUser() actor: AuthenticatedUser,
	  @UuidParam("organizationId") organizationId: string,
	  @UuidParam("projectId") projectId: string,
	  @Body() dto: CreateApiKeyDto,
	) {
	  return this.apiKeys.create(
		actor.id,
		organizationId,
		projectId,
		dto,
	  );
	}

	@Get()
	@Header("Cache-Control", "no-store")
	list(
	  @CurrentUser() actor: AuthenticatedUser,
	  @UuidParam("organizationId") organizationId: string,
	  @UuidParam("projectId") projectId: string,
	) {
	  return this.apiKeys.list(
		actor.id,
		organizationId,
		projectId,
	  );
	}

	@Delete(":apiKeyId")
	@HttpCode(HttpStatus.NO_CONTENT)
	@Header("Cache-Control", "no-store")
	revoke(
	  @CurrentUser() actor: AuthenticatedUser,
	  @UuidParam("organizationId") organizationId: string,
	  @UuidParam("projectId") projectId: string,
	  @UuidParam("apiKeyId") apiKeyId: string,
	): Promise<void> {
	  return this.apiKeys.revoke(
		actor.id,
		organizationId,
		projectId,
		apiKeyId,
	  );
	}
  }
