import { INestApplication } from "@nestjs/common";
import { requestIdMiddleware } from "./common/middleware/request-id.middleware";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import { createValidationPipe } from "./common/validation/create-validation";
import { requestLoggingMiddleware } from "./common/middleware/request.middleware";
import { API_PREFIX } from "./common/constants/http.constants";

export function configureApp(app: INestApplication): void {
	app.use(requestIdMiddleware);
	app.use(requestLoggingMiddleware);
	app.setGlobalPrefix(API_PREFIX);
	app.useGlobalFilters(new ApiExceptionFilter());
	app.useGlobalPipes(createValidationPipe());
}
