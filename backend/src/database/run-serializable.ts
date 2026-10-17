import { HttpStatus } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { ApiException } from "../common/errors/api.exception";
import { PrismaService } from "./prisma.service";

type DatabaseError = {
	code?: string;
	name?: string;
	cause?: {
		kind?: string;
	};
	meta?: {
		target?: unknown;
		driverAdapterError?: {
			cause?: {
				constraint?: {
					fields?: unknown;
					name?: unknown;
				};
			};
		};
	};
};

export function isSerializationConflict(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;

	const value = error as DatabaseError;

	return value.code === "P2034" ||
		(
			value.name === "DriverAdapterError" &&
			value.cause?.kind === "TransactionWriteConflict"
		);
}

export function isTraceIdentityConflict(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;

	const value = error as DatabaseError;

	if (value.code !== "P2002") return false;

	const constraint =
		value.meta?.driverAdapterError?.cause?.constraint;

	const candidates = [
		value.meta?.target,
		constraint?.fields,
		constraint?.name,
	];

	return candidates.some(target => {
		if (typeof target === "string") {
			return target === "Trace_projectId_externalId_key";
		}

		return Array.isArray(target) &&
			target.length === 2 &&
			target.includes("projectId") &&
			target.includes("externalId");
	});
}

export async function runSerializable<T>(
	prisma: PrismaService,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
	retryUnique?: (error: unknown) => boolean,
): Promise<T> {
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			return await prisma.$transaction(work, {
				isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
				maxWait: 5000,
				timeout: 10_000,
			});
		} catch (error) {
			const retryable =
				isSerializationConflict(error) ||
				retryUnique?.(error) === true;

			if (!retryable) throw error;

			if (attempt === 3) {
				throw new ApiException(
					HttpStatus.CONFLICT,
					"CONCURRENT_MODIFICATION",
					"Concurrent modification detected. Please retry.",
				);
			}
		}
	}

	throw new Error("Unreachable transaction state.");
}
