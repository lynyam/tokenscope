/**
 * TEST FILE — unit
 * Suite:  npm run test:unit   (config: test/jest-unit.json)
 * Scope:  UsersService with a fake PrismaService. No real database.
 *         Real-database behaviour (unique constraints) is proved
 *         separately in test/database/auth.integration.spec.ts (STEP 12).
 */
import { Test, TestingModule } from "@nestjs/testing";
import { UsersService } from "../../src/users/users.service";
import { PrismaService } from "../../src/database/prisma.service";

jest.mock("../../src/database/prisma.service", () => ({
  PrismaService: class PrismaService {},
}));


describe("UsersService", () => {
  let service: UsersService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  /**
   * beforeEach(fn): A Jest lifecycle hook that runs before every single test 
   *                 case (it) in this describe block. It ensures a clean, 
   *                 isolated setup before each test executes.
   */
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it("findByEmail queries the exact email given, without re-normalizing", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });

    await service.findByEmail("alice@example.com");

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: "alice@example.com" },
    });
  });

  it("findById queries by id", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });

    await service.findById("user-1");

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
    });
  });

  it("create forwards the data object unchanged to Prisma", async () => {
    const data = {
      email: "alice@example.com",
      passwordHash: "$argon2id$hash",
      displayName: "Alice",
    };
    prismaMock.user.create.mockResolvedValue({ id: "user-1", ...data });

    await service.create(data);

    expect(prismaMock.user.create).toHaveBeenCalledWith({ data });
  });
});