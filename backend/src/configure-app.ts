import { INestApplication } from "@nestjs/common";
import { requestIdMiddleware } from "./common/middleware/request-id.middleware";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";

export function configureApp(app: INestApplication): void {
	app.use(requestIdMiddleware);
	app.setGlobalPrefix("api/v1");
	app.useGlobalFilters(new ApiExceptionFilter());
}
