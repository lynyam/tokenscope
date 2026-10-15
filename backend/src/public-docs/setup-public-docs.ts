import type { INestApplication } from "@nestjs/common";
import swaggerUi = require("swagger-ui-express");

export function setupPublicDocs(app: INestApplication): void {
	app.use(
		"/api/v1/public/docs",
		swaggerUi.serve,
		swaggerUi.setup(undefined, {
			customSiteTitle: "TokenScope Public API",
			swaggerOptions: {
				url: "/api/v1/public/openapi.json",
				persistAuthorization: false,
				validatorUrl: null,
				supportedSubmitMethods: ["get", "post", "put", "delete"],
			},
		}),
	);
}