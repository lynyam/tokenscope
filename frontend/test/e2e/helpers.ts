import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

export const UPLOADS = path.resolve(__dirname, "../../../fixtures/evaluation/uploads");
export const fixturePath = (name: string) => path.join(UPLOADS, name);
export const fixtureBytes = (name: string) => readFileSync(fixturePath(name));

const API = "/api/v1";
const PASSWORD = "e2e-password-12345";
export { PASSWORD as TEST_PASSWORD };
const MIME: Record<string, string> = { pdf: "application/pdf", md: "text/markdown", txt: "text/plain" };
let counter = 0;

export interface TestUser { email: string; token: string }

/** Every test creates its own disposable accounts: no shared demo data is ever touched. */
export async function signUp(request: APIRequestContext, label: string): Promise<TestUser> {
  counter += 1;
  const email = `e2e-${label}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const response = await request.post(`${API}/auth/signup`, { data: { email, password: PASSWORD, displayName: `E2E ${label}` } });
  expect(response.status(), "sign-up").toBe(201);
  return { email, token: (await response.json()).accessToken };
}

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

export async function createOrganization(request: APIRequestContext, owner: TestUser): Promise<string> {
  const response = await request.post(`${API}/organizations`, { headers: auth(owner), data: { name: `E2E Org ${Date.now()}` } });
  expect(response.status(), "create organization").toBe(201);
  return (await response.json()).id;
}

export async function createProject(request: APIRequestContext, owner: TestUser, organizationId: string, name: string): Promise<string> {
  const response = await request.post(`${API}/organizations/${organizationId}/projects`, { headers: auth(owner), data: { name } });
  expect(response.status(), "create project").toBe(201);
  return (await response.json()).id;
}

export async function addMember(request: APIRequestContext, owner: TestUser, organizationId: string, member: TestUser, role: "ADMIN" | "MEMBER") {
  const response = await request.post(`${API}/organizations/${organizationId}/members`, { headers: auth(owner), data: { email: member.email, role } });
  expect(response.status(), `add ${role}`).toBe(201);
}

export const documentsApi = (organizationId: string, projectId: string) => `${API}/organizations/${organizationId}/projects/${projectId}/documents`;
export const documentsPage = (organizationId: string, projectId: string) => `/organizations/${organizationId}/projects/${projectId}/documents`;

export interface UploadedDocument { id: string; originalName: string }

/** Seeds a document through the real API (the same endpoint the browser uses). */
export async function uploadViaApi(
  request: APIRequestContext, user: TestUser, organizationId: string, projectId: string,
  name: string, buffer: Buffer,
): Promise<UploadedDocument> {
  const response = await request.post(documentsApi(organizationId, projectId), {
    headers: auth(user),
    multipart: { file: { name, mimeType: MIME[name.split(".").pop()!.toLowerCase()], buffer } },
  });
  expect(response.status(), `upload ${name}`).toBe(201);
  return response.json();
}

export async function apiGet(request: APIRequestContext, user: TestUser, url: string) {
  return request.get(url, { headers: auth(user) });
}

/** A browser context that is already signed in as this user (the app reads the token from storage). */
export async function signedInContext(browser: Browser, baseURL: string | undefined, user: TestUser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL, acceptDownloads: true });
  await context.addInitScript(token => localStorage.setItem("tokenscope.accessToken", token), user.token);
  return context;
}

export async function signInPage(page: Page, user: TestUser) {
  await page.context().addInitScript(token => localStorage.setItem("tokenscope.accessToken", token), user.token);
}

/** Counts requests of a given method whose path ends with the suffix. */
export function trackRequests(page: Page, method: string, pathSuffix: RegExp) {
  const seen: string[] = [];
  page.on("request", request => {
    if (request.method() === method && pathSuffix.test(new URL(request.url()).pathname)) seen.push(request.url());
  });
  return seen;
}
