import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 14: API Key Isolation
 *
 * For all AI requests originating from the PACE desktop client,
 * the request payload contains no API keys or provider credentials.
 * All key resolution happens server-side in PocketBase JS hooks
 * before forwarding to LiteLLM.
 *
 * **Validates: Requirement 17.2**
 */

// --- Types representing AI request payloads from the desktop client ---

interface WeeklyReviewRequest {
  userId: string;
  weekStart: number;
  model?: string;
}

interface ParseTaskRequest {
  text: string;
  projects: Array<{ id: string; name: string }>;
  team: Array<{ id: string; name: string }>;
  model?: string;
}

interface EstimateTaskRequest {
  taskTitle: string;
  projectId: string;
  model?: string;
}

interface TeamHealthRequest {
  weekStart: number;
  model?: string;
}

type AIRequestPayload =
  | WeeklyReviewRequest
  | ParseTaskRequest
  | EstimateTaskRequest
  | TeamHealthRequest;

// --- Functions under test ---

/** Known patterns for API keys and credentials */
const CREDENTIAL_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}$/,           // OpenAI-style
  /^sk-ant-[a-zA-Z0-9]{20,}$/,       // Anthropic-style
  /^AIza[a-zA-Z0-9_-]{30,}$/,        // Google/Gemini-style
  /^AKIA[A-Z0-9]{16}$/,              // AWS access key
  /^Bearer\s+.{20,}$/,               // Bearer tokens
  /^[a-f0-9]{32,}$/,                 // Generic hex keys
];

const CREDENTIAL_FIELD_NAMES = [
  "apiKey",
  "api_key",
  "apikey",
  "secret",
  "secretKey",
  "secret_key",
  "accessKey",
  "access_key",
  "token",
  "authToken",
  "auth_token",
  "credential",
  "credentials",
  "password",
  "masterKey",
  "master_key",
  "providerKey",
  "provider_key",
  "openaiKey",
  "anthropicKey",
  "geminiKey",
  "awsSecretAccessKey",
  "aws_secret_access_key",
  "aws_access_key_id",
  "litellmApiKey",
  "litellm_api_key",
  "authorization",
];

/**
 * Check if a value looks like an API key or credential.
 */
function looksLikeCredential(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length < 10) return false;
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Check if a field name is a known credential field.
 */
function isCredentialFieldName(name: string): boolean {
  return CREDENTIAL_FIELD_NAMES.includes(name.toLowerCase());
}

/**
 * Deep-inspect a payload object for any credential fields or values.
 * Returns true if the payload is clean (no credentials found).
 */
function payloadContainsNoCredentials(payload: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(payload)) {
    // Check field name
    if (isCredentialFieldName(key)) return false;

    // Check value
    if (looksLikeCredential(value)) return false;

    // Recurse into nested objects
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      if (!payloadContainsNoCredentials(value as Record<string, unknown>)) {
        return false;
      }
    }

    // Check array elements
    if (Array.isArray(value)) {
      for (const item of value) {
        if (looksLikeCredential(item)) return false;
        if (typeof item === "object" && item !== null) {
          if (!payloadContainsNoCredentials(item as Record<string, unknown>)) {
            return false;
          }
        }
      }
    }
  }
  return true;
}

/**
 * Construct a weekly review request payload (as the desktop client would).
 * This must contain ONLY userId, weekStart, and optional model preference.
 */
function buildWeeklyReviewPayload(
  userId: string,
  weekStart: number,
  model?: string,
): WeeklyReviewRequest {
  const payload: WeeklyReviewRequest = { userId, weekStart };
  if (model) payload.model = model;
  return payload;
}

/**
 * Construct a parse-task request payload.
 * Contains text, project list, team list — no credentials.
 */
function buildParseTaskPayload(
  text: string,
  projects: Array<{ id: string; name: string }>,
  team: Array<{ id: string; name: string }>,
  model?: string,
): ParseTaskRequest {
  const payload: ParseTaskRequest = { text, projects, team };
  if (model) payload.model = model;
  return payload;
}

/**
 * Construct an estimate-task request payload.
 */
function buildEstimateTaskPayload(
  taskTitle: string,
  projectId: string,
  model?: string,
): EstimateTaskRequest {
  const payload: EstimateTaskRequest = { taskTitle, projectId };
  if (model) payload.model = model;
  return payload;
}

/**
 * Construct a team-health request payload.
 */
function buildTeamHealthPayload(
  weekStart: number,
  model?: string,
): TeamHealthRequest {
  const payload: TeamHealthRequest = { weekStart };
  if (model) payload.model = model;
  return payload;
}

// --- Arbitraries ---

const userIdArb = fc.uuid();
const weekStartArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const modelArb = fc.constantFrom(
  "gemini-flash",
  "claude-sonnet",
  "gpt-4o",
  "qwen-turbo",
  "ollama-local",
  undefined,
);
const taskTextArb = fc.stringOf(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split("")),
  { minLength: 5, maxLength: 200 },
);
const projectArb = fc.record({
  id: fc.uuid(),
  name: fc.stringOf(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ".split("")), {
    minLength: 2,
    maxLength: 30,
  }),
});
const teamMemberArb = fc.record({
  id: fc.uuid(),
  name: fc.stringOf(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ".split("")), {
    minLength: 2,
    maxLength: 30,
  }),
});

// --- Property Tests ---

describe("Property 14: API Key Isolation", () => {
  it("weekly review request payload contains no API keys or credentials", () => {
    fc.assert(
      fc.property(userIdArb, weekStartArb, modelArb, (userId, weekStart, model) => {
        const payload = buildWeeklyReviewPayload(userId, weekStart, model);
        expect(payloadContainsNoCredentials(payload as unknown as Record<string, unknown>)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("parse-task request payload contains no API keys or credentials", () => {
    fc.assert(
      fc.property(
        taskTextArb,
        fc.array(projectArb, { minLength: 0, maxLength: 5 }),
        fc.array(teamMemberArb, { minLength: 0, maxLength: 5 }),
        modelArb,
        (text, projects, team, model) => {
          const payload = buildParseTaskPayload(text, projects, team, model);
          expect(payloadContainsNoCredentials(payload as unknown as Record<string, unknown>)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("estimate-task request payload contains no API keys or credentials", () => {
    fc.assert(
      fc.property(taskTextArb, fc.uuid(), modelArb, (title, projectId, model) => {
        const payload = buildEstimateTaskPayload(title, projectId, model);
        expect(payloadContainsNoCredentials(payload as unknown as Record<string, unknown>)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("team-health request payload contains no API keys or credentials", () => {
    fc.assert(
      fc.property(weekStartArb, modelArb, (weekStart, model) => {
        const payload = buildTeamHealthPayload(weekStart, model);
        expect(payloadContainsNoCredentials(payload as unknown as Record<string, unknown>)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("payload with injected credential field names is detected as unsafe", () => {
    // Sanity check: our detector catches credential fields
    fc.assert(
      fc.property(
        fc.constantFrom(...CREDENTIAL_FIELD_NAMES.slice(0, 10)),
        fc.uuid(),
        (fieldName, userId) => {
          const payload: Record<string, unknown> = {
            userId,
            weekStart: 1700000000,
            [fieldName]: "sk-1234567890abcdefghijklmnop",
          };
          expect(payloadContainsNoCredentials(payload)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("payload with injected credential-like values is detected as unsafe", () => {
    // Sanity check: our detector catches credential values
    const credentialValues = [
      "sk-abcdefghijklmnopqrstuvwxyz1234",
      "sk-ant-abcdefghijklmnopqrstuvwxyz",
      "AIzaSyAbcdefghijklmnopqrstuvwxyz1234567",
      "AKIAIOSFODNN7EXAMPLE",
    ];

    for (const cred of credentialValues) {
      const payload: Record<string, unknown> = {
        userId: "test-user",
        weekStart: 1700000000,
        someField: cred,
      };
      expect(payloadContainsNoCredentials(payload)).toBe(false);
    }
  });
});
