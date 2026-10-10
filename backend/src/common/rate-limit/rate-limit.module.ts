import { Module } from "@nestjs/common";
import {
  RateLimitClock,
  RateLimitService,
} from "./rate-limit.service";

@Module({
  providers: [
    RateLimitClock,
    RateLimitService,
  ],
  exports: [
    RateLimitClock,
    RateLimitService,
  ],
})
export class RateLimitModule {}
