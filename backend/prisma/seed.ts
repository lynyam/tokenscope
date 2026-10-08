import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main(prisma: PrismaClient): Promise<void> {
	const userA = await prisma.user.upsert({
		where: { email: "alice@tokenscope.dev" },
		update: {},
		create: {
			email: "alice@tokenscope.dev",
			passwordHash: "seed-password-hash",
			displayName: "Alice",
		},
		select: { id: true },
	});

	const userB = await prisma.user.upsert({
		where: { email: "bob@tokenscope.dev" },
		update: {},
		create: {
			email: "bob@tokenscope.dev",
			passwordHash: "seed2-password-hash",
			displayName: "Bob",
		},
		select: { id: true },
	});

	const organization = await prisma.organization.upsert({
		where: { slug: "a-ai" },
		update: {},
		create: { name: "A.ai", slug: "a-ai" },
		select: { id: true },
	});

	await prisma.membership.upsert({
		where: {
			organizationId_userId: {
				organizationId: organization.id,
				userId: userA.id,
			},
		},
		update: { role: "OWNER" },
		create: {
			organizationId: organization.id,
			userId: userA.id,
			role: "OWNER",
		},
		select: { id: true },
	});

	await prisma.membership.upsert({
		where: {
			organizationId_userId: {
				organizationId: organization.id,
				userId: userB.id,
			},
		},
		update: { role: "MEMBER" },
		create: {
			organizationId: organization.id,
			userId: userB.id,
			role: "MEMBER",
		},
		select: { id: true },
	});

	const project = await prisma.project.upsert({
		where: {
			organizationId_slug: {
				organizationId: organization.id,
				slug: "chatbot-client-service",
			},
		},
		update: { name: "Chatbot Client Service" },
		create: {
			organizationId: organization.id,
			slug: "chatbot-client-service",
			name: "Chatbot Client Service",
		},
		select: { id: true },
	});

	console.log(JSON.stringify({
		event: "seed_completed",
		organizationId: organization.id,
		projectId: project.id,
	}));
}

async function runSeed(): Promise<void> {
	let prisma: PrismaClient | undefined;
	try {
		const connectionString = process.env.DATABASE_URL;
		if (!connectionString) {
			throw new Error("DATABASE_URL is required.");
		}

		const adapter = new PrismaPg({
			connectionString,
			connectionTimeoutMillis: 5000,
		});
		prisma = new PrismaClient({ adapter, log: [] });
		await main(prisma);
	} catch {
		console.error(JSON.stringify({
			event: "seed_failed",
			message: "Database seed failed. Check configuration and database availability.",
		}));
		process.exitCode = 1;
	} finally {
		try {
			await prisma?.$disconnect();
		} catch {
			console.error(JSON.stringify({
				event: "seed_disconnect_failed",
				message: "Database disconnection failed.",
			}));
			process.exitCode = 1;
		}
	}
}
void runSeed();
