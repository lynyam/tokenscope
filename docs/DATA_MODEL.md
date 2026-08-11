## Domain model v1

```prisma
model User {
  id           String       @id @default(uuid())
  email        String       @unique
  passwordHash String
  displayName  String
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  memberships  Membership[]
  ownedOrganizations Organization[] @relation("OrganizationOwner")
}

model Organization {
  id          String       @id @default(uuid())
  name        String
  slug        String       @unique
  ownerId     String
  owner       User         @relation("OrganizationOwner", fields: [ownerId], references: [id])
  memberships Membership[]
  projects    Project[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model Membership {
  id             String           @id @default(uuid())
  userId         String
  organizationId String
  role           MembershipRole   @default(MEMBER)
  user           User             @relation(fields: [userId], references: [id])
  organization   Organization     @relation(fields: [organizationId], references: [id])
  createdAt      DateTime         @default(now())

  @@unique([userId, organizationId])
}

enum MembershipRole {
  OWNER
  ADMIN
  MEMBER
}

model Project {
  id             String       @id @default(uuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  name           String
  slug           String
  description    String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  archivedAt     DateTime?

  @@unique([organizationId, slug])
}
```
