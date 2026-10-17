import { Module } from "@nestjs/common";
import { PublicDocsController } from "./public-docs.controller";

@Module({
	controllers: [PublicDocsController],
})
export class PublicDocsModule { }