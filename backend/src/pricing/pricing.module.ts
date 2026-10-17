import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import {
	PriceFiltersPipe,
	PricingController,
} from "./pricing.controller";
import { PricingService } from "./pricing.service";

@Module({
	imports: [DatabaseModule],
	controllers: [PricingController],
	providers: [PricingService, PriceFiltersPipe],
	exports: [PricingService],
})
export class PricingModule { }
