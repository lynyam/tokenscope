import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { MembershipRole, PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({
	connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
	const userA = await prisma.user.upsert({
		where: {
			email: "alice@tokenscope.dev",
		},
		update: {},
		create: {
			email: "alice@tokenscope.dev",
			passwordHash: "seed-password-hash",
			displayName: "Alice",
		},
	});
	console.log(userA);
	const userB = await prisma.user.upsert({
		where: {
			email: "bob@tokenscope.dev",
		},
		update: {},
		create: {
			email: "bob@tokenscope.dev",
			passwordHash: "seed2-password-hash",
			displayName: "Bob",
		},
	});
	console.log(userB);
	const organization = await prisma.organization.upsert({
		where: {
			slug: "a-ai",
		},
		update: {},
		create: {
			name: "A.ai",
			slug: "a-ai",
		},
	});
	console.log(organization);

	const MembershipA = await prisma.membership.upsert({
		where: {
			organizationId_userId: {
				organizationId: organization.id,
				userId: userA.id,
			}
		},
		update: {
			role: "OWNER",
		},

		create: {
			organizationId: organization.id,
			userId: userA.id,
			role: "OWNER",
		},
	});
	const MembershipB = await prisma.membership.upsert({
		where: {
			organizationId_userId: {
				organizationId: organization.id,
				userId: userB.id,
			}
		},
		update: {
			role: "MEMBER",
		},

		create: {
			organizationId: organization.id,
			userId: userB.id,
			role: "MEMBER",
		},
	});

	const project = await prisma.project.upsert({
		where: {
			organizationId_slug: {
				organizationId: organization.id,
				slug: "chatbot-client-service",
			},
		},
		update: {
			name: "Chatbot Client Service",
		},
		create: {
			organizationId: organization.id,
			slug: "chatbot-client-service",
			name: "Chatbot Client Service",
		},
	});
	const result = await prisma.organization.findUnique({
		where: {
		  slug: "a-ai",
		},
		include: {
		  memberships: {
			include: {
			  user: true,
			},
		  },
		  projects: true,
		},
	  });

	  console.dir(result, { depth: null });
}

main()
	.catch((error) => {
		console.error(error);
		process.exit(1);
	})
	.finally(async() => {
		await prisma.$disconnect();
	});
