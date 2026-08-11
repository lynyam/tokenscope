# TokenScope Sprint 1 — Identity & Workspace Foundation

**Sprint 1 goal:**
Build the authenticated workspace foundation required for every later TokenScope feature.

## Sprint 1 demo target
```text
User A signs up
→ User A creates an organization
→ User A creates a project
→ User B signs up
→ User A adds User B to the organization
→ User B logs in
→ User B sees the shared organization and project
→ Unauthorized access to another organization is rejected
```

## Architecture scope

Sprint 1 creates four domain modules:

```text
Auth
Users
Organizations
Projects
```

## Sprint 1 No Goals
```text
No API keys.
No traces.
No LLM cost calculation.
No dashboard analytics.
No RAG.
No AI assistant.
No WebSockets.
```


## Backend module boundaries

```text
src/
  auth/
    auth.controller.ts
    auth.service.ts
    dto/
    guards/
    strategies/
  users/
    users.service.ts
    users.repository.ts
  organizations/
    organizations.controller.ts
    organizations.service.ts
    dto/
  projects/
    projects.controller.ts
    projects.service.ts
    dto/
  common/
    decorators/
    filters/
    guards/
    pipes/
    types/
```

## Frontend route boundaries

```text
src/
  pages/
    auth/
      SignInPage.tsx
      SignUpPage.tsx
    organizations/
      OrganizationsPage.tsx
      OrganizationDetailPage.tsx
      MembersPage.tsx
    projects/
      ProjectsPage.tsx
      ProjectDetailPage.tsx
  components/
    layout/
    forms/
    feedback/
  api/
    auth.api.ts
    organizations.api.ts
    projects.api.ts
  hooks/
    useCurrentUser.ts
    useOrganizations.ts
```

## Domain model

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


## Authorization matrix v1

| Action | OWNER | ADMIN | MEMBER | Anonymous |
|---|---:|---:|---:|---:|
| Sign up / sign in | yes | yes | yes | yes |
| View own user profile | yes | yes | yes | no |
| Create organization | yes | yes | yes | no |
| View organization | yes | yes | yes | no |
| Rename organization | yes | no | no | no |
| Add member | yes | no | no | no |
| Remove member | yes | no | no | no |
| Change member role | yes | no | no | no |
| Create project | yes | yes | no | no |
| View project | yes | yes | yes | no |
| Update project | yes | yes | no | no |
| Archive/delete project | yes | yes | no | no |

## API contract v1

### Auth

```http
POST /auth/signup
POST /auth/signin
POST /auth/logout
GET  /auth/me
```

### Organizations

```http
GET    /organizations
POST   /organizations
GET    /organizations/:organizationId
PATCH  /organizations/:organizationId
GET    /organizations/:organizationId/members
POST   /organizations/:organizationId/members
PATCH  /organizations/:organizationId/members/:userId
DELETE /organizations/:organizationId/members/:userId
```

### Projects

```http
GET    /organizations/:organizationId/projects
POST   /organizations/:organizationId/projects
GET    /organizations/:organizationId/projects/:projectId
PATCH  /organizations/:organizationId/projects/:projectId
DELETE /organizations/:organizationId/projects/:projectId
```

## Error contract v1

Use consistent JSON errors:

```json
{
  "error": "Forbidden",
  "message": "You are not allowed to access this organization.",
  "statusCode": 403,
  "requestId": "req_..."
}
```

## Definition of Done
- Authentication works end-to-end.
- Passwords are hashed before storage.
- Authenticated routes are protected.
- Users can create organizations.
- Organizations have members and roles.
- Users can create projects inside organizations.
- Organization access is scoped: a user cannot access another organization by guessing IDs.
- Frontend has sign-up, sign-in, organization, member, and project screens.
- Two-browser demo works.
- Prisma migrations are committed.
- README and docs are updated.
- Every PR is linked to a Linear issue.
