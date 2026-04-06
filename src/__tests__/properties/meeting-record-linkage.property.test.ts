import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createMeeting, validateMeetingTitle } from "@/lib/meetings";

/**
 * Property 33: Meeting record linkage
 *
 * For any meeting logged via the idle modal, the meeting record should
 * reference a valid breakId and sessionId, and the title must be non-empty.
 *
 * **Validates: Requirements 20.2**
 */

// --- Generators ---

const idArb = fc.stringMatching(/^[a-z0-9-]{1,20}$/);
const nonEmptyTitleArb = fc.string({ minLength: 1, maxLength: 100 }).filter(
  (s) => s.trim().length > 0,
);
const attendeesArb = fc.option(
  fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }).map(
    (names) => names.join(", "),
  ),
  { nil: null },
);

// --- Property Tests ---

describe("Property 33: Meeting record linkage", () => {
  it("every meeting has a valid breakId and sessionId, title is non-empty (Req 20.2)", () => {
    fc.assert(
      fc.property(
        idArb,
        idArb,
        idArb,
        nonEmptyTitleArb,
        attendeesArb,
        (id, breakId, sessionId, title, attendees) => {
          const meeting = createMeeting(id, breakId, sessionId, title, attendees);

          // INVARIANT: meeting references the provided breakId and sessionId
          expect(meeting.breakId).toBe(breakId);
          expect(meeting.sessionId).toBe(sessionId);

          // INVARIANT: title is non-empty after trimming
          expect(meeting.title.trim().length).toBeGreaterThan(0);

          // INVARIANT: id is preserved
          expect(meeting.id).toBe(id);

          // INVARIANT: createdAt is a positive timestamp
          expect(meeting.createdAt).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("meetings with empty titles are rejected (Req 20.2)", () => {
    fc.assert(
      fc.property(
        idArb,
        idArb,
        idArb,
        fc.constantFrom("", "   ", "\t", "\n"),
        attendeesArb,
        (id, breakId, sessionId, emptyTitle, attendees) => {
          // INVARIANT: empty/whitespace-only titles are rejected
          expect(() => createMeeting(id, breakId, sessionId, emptyTitle, attendees)).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validateMeetingTitle correctly identifies valid vs invalid titles (Req 20.2)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }),
        (title) => {
          const isValid = validateMeetingTitle(title);
          const hasTrimmedContent = title.trim().length > 0;

          // INVARIANT: validation matches whether trimmed title is non-empty
          expect(isValid).toBe(hasTrimmedContent);
        },
      ),
      { numRuns: 200 },
    );
  });
});
