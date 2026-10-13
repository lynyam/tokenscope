import {
	Controller,
	Get,
	Injectable,
	PipeTransform,
	Query,
} from "@nestjs/common";
import {
	normalizeIdentifier,
	plainObject,
	rejectUnknownFields,
} from "../common/validation/usage-values";
import {
	PricingService,
	type PriceFilters,
} from "./pricing.service";

@Injectable()
export class PriceFiltersPipe
	implements PipeTransform<unknown, PriceFilters>
{
	transform(value: unknown): PriceFilters {
		const query = plainObject(value, "query");
		rejectUnknownFields(query, ["provider", "model"]);

		return {
			...(query.provider === undefined
				? {}
				: { provider: normalizeIdentifier(query.provider, "provider") }),
			...(query.model === undefined
				? {}
				: { model: normalizeIdentifier(query.model, "model") }),
		};
	}
}

// The existing global JWT guard protects this controller.
@Controller("model-prices")
export class PricingController {
	constructor(private readonly pricing: PricingService) { }

	@Get()
	list(@Query(PriceFiltersPipe) filters: PriceFilters) {
		return this.pricing.list(filters);
	}
}
