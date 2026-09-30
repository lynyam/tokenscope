import { User, Organization, Membership, Project } from '../types/workspace.types';


export const mockUsers: User[] = [
    {
        id: "user-alice",
        email: "alice@tokenscope.dev",
        displayName: "Alice",
    },
    {
        id: "user-bob",
        email: "bob@tokenscope.dev",
        displayName: "Bob",
    },
    {
        id: "user-charlie",
        email: "charlie@tokenscope.dev",
        displayName: "Charlie",
    },
    {
        id: "user-dina",
        email: "mockdiana@test.com",
        displayName: "dina"
    },
];



export const mockOrganizations: Organization[] = [
    {
        id: "mockorganization",
        name: "MockOrg",
        slug: "mock-organization-test",
        createdAt: "2026-01-20T00:00:00.000Z",
        updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
        id: "fausseorg",
        name: "xlIton",
        slug: "xlitn-org-test",
        createdAt: "2026-01-20T00:00:00.000Z",
        updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
        id: "organization-acme",
        name: "Acme AI",
        slug: "acme-ai",
        createdAt: "2026-01-20T00:00:00.000Z",
        updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
        id: "organization-observability-lab",
        name: "Observability Lab",
        slug: "observability-lab",
        createdAt: "2026-01-20T00:00:00.000Z",
        updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
        id: "organization-private-research",
        name: "Private Research",
        slug: "private-research",
        createdAt: "2026-01-20T00:00:00.000Z",
        updatedAt: "2026-01-20T00:00:00.000Z",
    },
];


export const mockMemberships: Membership[] = [
    {
      id: "membership-acme-alice",
      userId: "user-alice",
      organizationId: "organization-acme",
      role: "OWNER",
      createdAt: "2026-01-20T00:00:00.000Z",
      updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
      id: "membership-acme-bob",
      userId: "user-bob",
      organizationId: "organization-acme",
      role: "ADMIN",
      createdAt: "2026-01-20T00:00:00.000Z",
      updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
      id: "membership-acme-charlie",
      userId: "user-charlie",
      organizationId: "organization-acme",
      role: "MEMBER",
      createdAt: "2026-01-20T00:00:00.000Z",
      updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
      id: "membership-observability-lab-diana",
      userId: "user-dina",
      organizationId: "organization-observability-lab",
      role: "OWNER",
      createdAt: "2026-01-20T00:00:00.000Z",
      updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
      id: "membership-observability-lab-alice",
      userId: "user-alice",
      organizationId: "organization-observability-lab",
      role: "MEMBER",
      createdAt: "2026-01-20T00:00:00.000Z",
      updatedAt: "2026-01-20T00:00:00.000Z",
    },
    {
      id: "membership-private-research-bob",
      userId: "user-bob",
      organizationId: "organization-private-research",
      role: "OWNER",
      createdAt: "2026-01-20T00:00:00.000Z",
      updatedAt: "2026-01-20T00:00:00.000Z",
    },
];

export const mockProjects: Project[] = [
    {
        id: "p1",
        organizationId: "mockorganization",
        name: "project 1",
        slug: "mock-project",
        description:"description test",
        archivedAt: null,
        createdAt: new Date("2026-01-20").toISOString(),
        updatedAt: new Date("2026-01-20").toISOString(),
    },
    {
        id: "project-acme-support-assistant",
        organizationId: "organization-acme",
        name: "Support Assistant",
        slug: "support-assistant",
        description: "Customer-support LLM observability project.",
        archivedAt: null,
        createdAt: new Date("2026-03-19").toISOString(),
        updatedAt: new Date("2026-03-19").toISOString(),
    },
    {
        id: "project-acme-rag-evaluator",
        organizationId: "organization-acme",
        name: "RAG Evaluator",
        slug: "rag-evaluator",
        description: "Archived retrieval evaluation workspace.",
        archivedAt: "2026-08-01T10:00:00.000Z",
        createdAt: new Date("2026-06-26").toISOString(),
        updatedAt: new Date("2026-06-26").toISOString(),
    },
    {
        id: "project-observability-cost-dashboard",
        organizationId: "organization-observability-lab",
        name: "Cost Dashboard",
        slug: "cost-dashboard",
        description: null,
        archivedAt: null,
        createdAt: new Date("2026-08-02").toISOString(),
        updatedAt: new Date("2026-08-02").toISOString(),
    },
    {
        id: "project-private-model-experiment",
        organizationId: "organization-private-research",
        name: "Model Experiment",
        slug: "model-experiment",
        description: "A project Alice must not be able to access.",
        archivedAt: null,
        createdAt: new Date("2026-10-04").toISOString(),
        updatedAt: new Date("2026-10-04").toISOString(),
    },
];
