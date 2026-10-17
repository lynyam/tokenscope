import { Module } from "@nestjs/common";
import { ConfigurationModule } from "./config/configuration.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { MembershipsModule } from "./memberships/memberships.module";
import { ProjectsModule } from "./projects/projects.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { TracesModule } from "./traces/traces.module";
import { DocumentsModule } from "./documents/documents.module";
import { PublicDocsModule } from "./public-docs/public-docs.module";
import { AnalyticsModule } from "./analytics/analytics.module";

@Module({
	imports: [
		ConfigurationModule,
		HealthModule,
		AuthModule,
		OrganizationsModule,
		MembershipsModule,
		ProjectsModule,
		ApiKeysModule,
		TracesModule,
		DocumentsModule,
		PublicDocsModule,
		AnalyticsModule,
	],
})
export class AppModule {}
