import { Module } from "@nestjs/common";
import { AccessChangesService } from "./access-changes.service";

@Module({ providers: [AccessChangesService], exports: [AccessChangesService] })
export class AccessChangesModule {}
