/** M1 HTTP types. docs/API.md is the canonical contract, including nullability. */
export interface User {
    id: string;
    email: string;
    displayName: string;
}
export interface AuthResponse {
  user: User;
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER";

export interface Organization {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
}


export interface Project {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    description: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface OrganizationSummary extends Organization {
    currentUserRole: MembershipRole; //contextual information derived from the
                                    //authenticated user’s membership. It does
                                    //not mean the organization owns a role.
}
//Add our Membership Entity type
export interface Membership {
    id: string;
    userId: string;
    organizationId: string;
    role: MembershipRole;
    createdAt: string;
    updatedAt: string;
}

/** Membership enriched with the safe user data required by TSE-35. */
export interface MembershipWithUser extends Membership {
    user: User;
}

export interface OrganizationMembershipsResponse {
    memberships: MembershipWithUser[];
    currentUserRole: MembershipRole;
}

//need for auth feature
export interface SignInInput {
    email: string;
    password: string;
}

export interface SignUpInput extends SignInInput {
    displayName: string;
}

export interface CreateOrganizationInput {
    name: string;
}

export interface UpdateOrganizationInput {
  name: string;
}

export interface AddOrganizationMemberInput {
  email: string;
  role?: MembershipRole;
}

export interface UpdateMemberRoleInput {
  role: MembershipRole;
}

export interface CreateProjectInput {
    name: string;
    description?: string;
}

export interface UpdateProjectInput {
    name?: string;
    description?: string | null;
}
