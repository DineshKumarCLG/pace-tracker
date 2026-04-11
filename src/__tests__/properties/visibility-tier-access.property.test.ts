import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isFounder, isAdmin, canAccess } from "@/lib/roles";
import type { VisibilityTier } from "@/lib/roles";

/**
 * Feature: founder-governance, Property 10: Visibility tier access control
 *
 * For any user role and visibility tier combination, access should be granted
 * if and only if:
 *   (a) tier is "everyone" — all authenticated users pass,
 *   (b) tier is "founders_only" — only users whose role contains "founder" or "ceo" pass,
 *   (c) tier is "admin_only" — only users whose role contains "admin" or "ceo" pass,
 *   (d) tier is "individual_only" — only the owning user passes.
 *
 * **Validates: Requirements 8.2, 9.2, 10.2, 11.2**
 */

// --- Arbitraries ---

const tierArb: fc.Arbitrary<VisibilityTier> = fc.constantFrom(
  "everyone",
  "founders_only",
  "admin_only",
  "individual_only",
);

/** Roles that contain "founder" or "ceo" (case-insensitive) */
const founderRoleArb = fc.constantFrom(
  "founder",
  "ceo",
  "co-founder",
  "CEO",
  "Founder",
  "Co-Founder",
  "senior_founder",
  "lead_ceo",
);

/** Roles that contain "admin" or "ceo" (case-insensitive) */
const adminRoleArb = fc.constantFrom(
  "admin",
  "ceo",
  "super_admin",
  "Admin",
  "CEO",
  "ADMIN",
  "lead_ceo",
);

/** Roles that are neither founder nor admin (no "founder", "ceo", or "admin" substring) */
const plainRoleArb = fc.constantFrom(
  "member",
  "employee",
  "intern",
  "designer",
  "engineer",
  "manager",
  "viewer",
);

/** Nullable role: either a plain string role or null */
const nullableRoleArb = fc.oneof(plainRoleArb, fc.constant(null));

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);

// --- Property Tests ---

describe("Property 10: Visibility tier access control", () => {
  it("everyone tier grants access to any role including null", () => {
    fc.assert(
      fc.property(
        fc.oneof(founderRoleArb, adminRoleArb, plainRoleArb, fc.constant(null), fc.constant("")),
        (role) => {
          expect(canAccess(role, "everyone")).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("founders_only tier grants access iff role contains 'founder' or 'ceo'", () => {
    fc.assert(
      fc.property(founderRoleArb, (role) => {
        expect(canAccess(role, "founders_only")).toBe(true);
        expect(isFounder(role)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("founders_only tier denies access when role has no 'founder' or 'ceo'", () => {
    fc.assert(
      fc.property(nullableRoleArb, (role) => {
        expect(canAccess(role, "founders_only")).toBe(false);
        expect(isFounder(role)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("admin_only tier grants access iff role contains 'admin' or 'ceo'", () => {
    fc.assert(
      fc.property(adminRoleArb, (role) => {
        expect(canAccess(role, "admin_only")).toBe(true);
        expect(isAdmin(role)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("admin_only tier denies access when role has no 'admin' or 'ceo'", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom("founder", "co-founder", "member", "employee", "intern"),
          fc.constant(null),
        ),
        (role) => {
          expect(canAccess(role, "admin_only")).toBe(false);
          expect(isAdmin(role)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("individual_only tier grants access iff userId === ownerId", () => {
    fc.assert(
      fc.property(
        fc.oneof(founderRoleArb, adminRoleArb, plainRoleArb, fc.constant(null)),
        userIdArb,
        (role, userId) => {
          // Same user → access granted
          expect(canAccess(role, "individual_only", userId, userId)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("individual_only tier denies access when userId !== ownerId", () => {
    fc.assert(
      fc.property(
        fc.oneof(founderRoleArb, adminRoleArb, plainRoleArb, fc.constant(null)),
        userIdArb,
        userIdArb,
        (role, userId, ownerId) => {
          fc.pre(userId !== ownerId);
          expect(canAccess(role, "individual_only", userId, ownerId)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("canAccess is consistent with isFounder for founders_only tier across random roles", () => {
    fc.assert(
      fc.property(
        fc.oneof(founderRoleArb, adminRoleArb, plainRoleArb, fc.constant(null), fc.constant("")),
        (role) => {
          const access = canAccess(role, "founders_only");
          const founder = isFounder(role);
          expect(access).toBe(founder);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("canAccess is consistent with isAdmin for admin_only tier across random roles", () => {
    fc.assert(
      fc.property(
        fc.oneof(founderRoleArb, adminRoleArb, plainRoleArb, fc.constant(null), fc.constant("")),
        (role) => {
          const access = canAccess(role, "admin_only");
          const admin = isAdmin(role);
          expect(access).toBe(admin);
        },
      ),
      { numRuns: 100 },
    );
  });
});
