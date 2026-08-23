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
        email: "mockdina@test.com",
        displayName: "dina"
    },
];

/** Add credentials only inside the mock; they are not User data. */
export const mockAccounts = [
    { userId: "user-alice", password: "password123" },
    { userId: "user-bob", password: "password123" },
    { userId: "user-charlie", password: "password123" },
    { userId: "user-diana", password: "password123" },
];

// mock-session state used by auth.api.ts.
export const mockSession: { currentUserId: string | null } = {
    currentUserId: null,
};

export const mockOrganizations: Organization[] = [
    {
        id: "mockorganization",
        name: "MockOrg",
        slug: "mock-organization-test",
    },
    {
        id: "fausseorg",
        name: "xlIton",
        slug: "xlitn-org-test",
    },
    {
        id: "organization-acme",
        name: "Acme AI",
        slug: "acme-ai",
    },
    {
        id: "organization-observability-lab",
        name: "Observability Lab",
        slug: "observability-lab",
    },
    {
        id: "organization-private-research",
        name: "Private Research",
        slug: "private-research",
    },
];
/** We don't need this
export const mockMembers: Member[] = [{
    id: "user-1",
    email: "mockdina@test.com",
    name: "anid",
    role: "ADMIN",
}];
*/

export const mockMemberships: Membership[] = [
    {
      id: "membership-acme-alice",
      userId: "user-alice",
      organizationId: "organization-acme",
      role: "OWNER",
    },
    {
      id: "membership-acme-bob",
      userId: "user-bob",
      organizationId: "organization-acme",
      role: "ADMIN",
    },
    {
      id: "membership-acme-charlie",
      userId: "user-charlie",
      organizationId: "organization-acme",
      role: "MEMBER",
    },
    {
      id: "membership-observability-lab-diana",
      userId: "user-diana",
      organizationId: "organization-observability-lab",
      role: "OWNER",
    },
    {
      id: "membership-observability-lab-alice",
      userId: "user-alice",
      organizationId: "organization-observability-lab",
      role: "MEMBER",
    },
    {
      id: "membership-private-research-bob",
      userId: "user-bob",
      organizationId: "organization-private-research",
      role: "OWNER",
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
    },
    {
        id: "project-acme-support-assistant",
        organizationId: "organization-acme",
        name: "Support Assistant",
        slug: "support-assistant",
        description: "Customer-support LLM observability project.",
        archivedAt: null,
    },
    {
        id: "project-acme-rag-evaluator",
        organizationId: "organization-acme",
        name: "RAG Evaluator",
        slug: "rag-evaluator",
        description: "Archived retrieval evaluation workspace.",
        archivedAt: "2026-08-01T10:00:00.000Z",
    },
    {
        id: "project-observability-cost-dashboard",
        organizationId: "organization-observability-lab",
        name: "Cost Dashboard",
        slug: "cost-dashboard",
        description: null,
        archivedAt: null,
    },
    {
        id: "project-private-model-experiment",
        organizationId: "organization-private-research",
        name: "Model Experiment",
        slug: "model-experiment",
        description: "A project Alice must not be able to access.",
        archivedAt: null,
    },
];
