import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { DatabaseModule } from "../database/database.module";

/**
 * STEP 3 — exports UsersService so AuthModule can inject it.
 *
 * Dependency rule #6 (SPRINT_1_ARCHITECTURE.md): AuthModule may depend
 * on UsersModule; UsersModule must NEVER import AuthModule. Keeping this
 * one-directional avoids needing forwardRef() to break a cycle.
 */
@Module({
  imports: [DatabaseModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}