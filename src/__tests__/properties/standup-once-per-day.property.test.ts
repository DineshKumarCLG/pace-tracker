import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { shouldShowStandupPrompt, createStandupResponse } from "@/lib/standup";
import type { StandupResponse } from "@/types";

/**
 * Property 31: Standup prompt once per day
 *
 * For any user on a workday, the standup prompt should appear on the first
 * session start of the day. If the prompt is dismissed or answered, subsequent
 * session starts on the same day should not trigger the prompt again.
 *
 * **Validates: Requirements 18.1, 18.4**
 */

// --- Generators ---

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{1,8}$/);

const dateArb = fc.date({
  min: new Date("2024-01-01"),
  max: new Date("2026-12-31"),
}).map((d) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
});

function makeResponse(userId: string, date: string, id: string): StandupResponse {
  return {
    id,
    userId,
    date,
    response: "Working on stuff",
    createdAt: 1700000000,
  };
}

// --- Property Tests ---

describe("Property 31: Standup prompt once per day", () => {
  it("shouldShowStandupPrompt returns false if response exists for today, true otherwise (Req 18.1, 18.4)", () => {
    fc.assert(
      fc.property(
        userIdArb,
        dateArb,
        fc.boolean(), // whether a response exists for today
        fc.array(
          fc.record({
            userId: userIdArb,
            date: dateArb,
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (userId, today, hasResponseToday, otherEntries) => {
          // Build existing responses from other entries
          const responses: StandupResponse[] = otherEntries.map((e, i) =>
            makeResponse(e.userId, e.date, `sr-other-${i}`),
          );

          // Optionally add a response for the target user+date
          if (hasResponseToday) {
            responses.push(makeResponse(userId, today, "sr-today"));
          }

          const result = shouldShowStandupPrompt(userId, today, responses);

          // Check if any response matches the user+date (including from otherEntries)
          const anyMatchExists = responses.some(
            (r) => r.userId === userId && r.date === today,
          );

          // INVARIANT: prompt shows iff no response exists for this user+date
          expect(result).toBe(!anyMatchExists);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("after creating a response, prompt no longer shows for that user+date (Req 18.4)", () => {
    fc.assert(
      fc.property(
        userIdArb,
        dateArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        (userId, date, responseText) => {
          const responses: StandupResponse[] = [];

          // Before response: prompt should show
          expect(shouldShowStandupPrompt(userId, date, responses)).toBe(true);

          // Create and add response
          const newResponse = createStandupResponse("sr-new", userId, date, responseText);
          responses.push(newResponse);

          // After response: prompt should NOT show
          expect(shouldShowStandupPrompt(userId, date, responses)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("response for one user does not suppress prompt for another user (Req 18.1)", () => {
    fc.assert(
      fc.property(
        userIdArb,
        userIdArb,
        dateArb,
        (userA, userB, date) => {
          // Skip if same user generated
          fc.pre(userA !== userB);

          const responses: StandupResponse[] = [
            makeResponse(userA, date, "sr-a"),
          ];

          // User A has responded → no prompt
          expect(shouldShowStandupPrompt(userA, date, responses)).toBe(false);

          // User B has NOT responded → prompt should show
          expect(shouldShowStandupPrompt(userB, date, responses)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
