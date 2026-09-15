import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { MembershipRole } from "../../src/generated/prisma/client";
import { createValidationPipe } from "../../src/common/validation/create-validation";
import { AddMemberDto } from "../../src/memberships/dto/add-member.dto";
import { UpdateMemberRoleDto } from "../../src/memberships/dto/update-member-role.dto";
import { toMembershipResponse } from "../../src/memberships/membership.mapper";
import type { MembershipRecord } from "../../src/memberships/membership.mapper";

describe("Membership input and response contracts", () => {
  const pipe = createValidationPipe();

  it("normalizes email and defaults an omitted role to MEMBER", async () => {
    const dto = await pipe.transform(
      { email: " Bob@Example.com " },
      { type: "body", metatype: AddMemberDto },
    );

    expect(dto).toBeInstanceOf(AddMemberDto);
    expect(dto).toEqual({
      email: "bob@example.com",
      role: MembershipRole.MEMBER,
    });
  });

  it.each([
    {
      label: "an explicit null role when adding",
      metatype: AddMemberDto,
      body: { email: "bob@example.com", role: null },
    },
    {
      label: "a non-string email",
      metatype: AddMemberDto,
      body: { email: 123 },
    },
    {
      label: "a client-supplied user ID",
      metatype: AddMemberDto,
      body: { email: "bob@example.com", userId: randomUUID() },
    },
    {
      label: "an unknown role",
      metatype: UpdateMemberRoleDto,
      body: { role: "SUPERADMIN" },
    },
    {
      label: "a missing role when updating",
      metatype: UpdateMemberRoleDto,
      body: {},
    },
    {
      label: "a null role when updating",
      metatype: UpdateMemberRoleDto,
      body: { role: null },
    },
  ])("rejects $label", async ({ metatype, body }) => {
    await expect(
      pipe.transform(body, { type: "body", metatype }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("returns ISO dates and excludes extra sensitive user fields", () => {
    const userId = randomUUID();

    const record: MembershipRecord = {
      id: randomUUID(),
      userId,
      organizationId: randomUUID(),
      role: MembershipRole.MEMBER,
      createdAt: new Date("2026-09-14T12:00:00.000Z"),
      updatedAt: new Date("2026-09-14T12:30:00.000Z"),
      user: {
        id: userId,
        email: "bob@example.com",
        displayName: "Bob",
      },
    };

    // Simulate an accidentally broader database result.
    const recordWithSecret = {
      ...record,
      user: {
        ...record.user,
        passwordHash: "DO_NOT_EXPOSE_THIS_HASH",
      },
    };

    const response = toMembershipResponse(recordWithSecret);

    expect(response.createdAt).toBe("2026-09-14T12:00:00.000Z");
    expect(response.updatedAt).toBe("2026-09-14T12:30:00.000Z");
    expect(response.user).toEqual({
      id: userId,
      email: "bob@example.com",
      displayName: "Bob",
    });
    expect(JSON.stringify(response)).not.toContain("passwordHash");
    expect(JSON.stringify(response)).not.toContain("DO_NOT_EXPOSE_THIS_HASH");
  });
});
