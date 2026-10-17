import { Module } from "@nestjs/common";
import {
  RateLimitClock,
  RateLimitService,
} from "./rate-limit.service";
import { ProjectReadLimitInterceptor } from "./project-read-limit.interceptor";

@Module({
  providers: [
    RateLimitClock,
    RateLimitService,
    ProjectReadLimitInterceptor,
  ],
  exports: [
    RateLimitClock,
    RateLimitService,
    ProjectReadLimitInterceptor,
  ],
})
export class RateLimitModule {}
