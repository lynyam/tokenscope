## Domain model v1

## Overview

- `User` represents a global TokenScope identity.
- `Organization` is the tenant boundary.
- `Membership` materializes the User ↔ Organization many-to-many relationship and carries the organization-scoped role.
- `Project` is owned by an Organization, not directly by a User.
- Organization ownership is represented by `Membership.role = OWNER`; there is no separate `ownerId`.

```text
User
- id
- email
- passwordHash
- displayName
- createdAt
- updatedAt
```
```text
Organization
- id
- name
- slug
- createdAt
- updatedAt
```
```text
Membership
- id
- userId
- organizationId
- role
- createdAt
- updatedAt
```
```text
MembershipRole
- OWNER
- ADMIN
- MEMBER
```
```text
Project
- id
- organizationId
- name
- slug
- description
- archivedAt
- createdAt
- updatedAt
```

## Relationships:
- User has many Memberships.
- Organization has many Memberships.
- Organization has many Projects.
- Membership belongs to exactly one User.
- Membership belongs to exactly one Organization.
- Project belongs to exactly one Organization.

## Database invariants(Things PostgreSQL actually guarantees):
- User.email is unique
- Membership(userId, organizationId) is unique
- Project(organizationId, slug) is unique
- Membership.userId references User.id
- Membership.organizationId references Organization.id
- Project.organizationId references Organization.id

## Application invariants(Things our schema does not completely enforce):
- Every active Organization must have >= 1 OWNER.
- The last OWNER cannot be removed/demoted.
- Only authorized organization members may access its projects.
- OWNER / ADMIN / MEMBER permissions must be enforced by backend logic.


NB: The schema is located inside backend/prisma/schema.prisma
