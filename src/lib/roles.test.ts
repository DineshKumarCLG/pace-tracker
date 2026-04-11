import { describe, it, expect } from "vitest";
import { isFounder, isAdmin, canAccess } from "@/lib/roles";

describe("isFounder", () => {
  it("returns true for 'founder' role", () => {
    expect(isFounder("founder")).toBe(true);
  });

  it("returns true for 'ceo' role", () => {
    expect(isFounder("ceo")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isFounder("Founder")).toBe(true);
    expect(isFounder("CEO")).toBe(true);
    expect(isFounder("Co-Founder")).toBe(true);
  });

  it("returns true when role contains founder substring", () => {
    expect(isFounder("co-founder")).toBe(true);
    expect(isFounder("senior_founder")).toBe(true);
  });

  it("returns false for non-founder roles", () => {
    expect(isFounder("admin")).toBe(false);
    expect(isFounder("member")).toBe(false);
    expect(isFounder("employee")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isFounder(null)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isFounder("")).toBe(false);
  });
});

describe("isAdmin", () => {
  it("returns true for 'admin' role", () => {
    expect(isAdmin("admin")).toBe(true);
  });

  it("returns true for 'ceo' role", () => {
    expect(isAdmin("ceo")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAdmin("Admin")).toBe(true);
    expect(isAdmin("CEO")).toBe(true);
    expect(isAdmin("ADMIN")).toBe(true);
  });

  it("returns true when role contains admin substring", () => {
    expect(isAdmin("super_admin")).toBe(true);
  });

  it("returns false for non-admin roles", () => {
    expect(isAdmin("founder")).toBe(false);
    expect(isAdmin("member")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAdmin(null)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAdmin("")).toBe(false);
  });
});

describe("canAccess", () => {
  it("everyone tier allows any role", () => {
    expect(canAccess("member", "everyone")).toBe(true);
    expect(canAccess("founder", "everyone")).toBe(true);
    expect(canAccess(null, "everyone")).toBe(true);
  });

  it("founders_only tier allows founders", () => {
    expect(canAccess("founder", "founders_only")).toBe(true);
    expect(canAccess("ceo", "founders_only")).toBe(true);
  });

  it("founders_only tier denies non-founders", () => {
    expect(canAccess("member", "founders_only")).toBe(false);
    expect(canAccess("admin", "founders_only")).toBe(false);
    expect(canAccess(null, "founders_only")).toBe(false);
  });

  it("admin_only tier allows admins", () => {
    expect(canAccess("admin", "admin_only")).toBe(true);
    expect(canAccess("ceo", "admin_only")).toBe(true);
  });

  it("admin_only tier denies non-admins", () => {
    expect(canAccess("founder", "admin_only")).toBe(false);
    expect(canAccess("member", "admin_only")).toBe(false);
    expect(canAccess(null, "admin_only")).toBe(false);
  });

  it("individual_only tier allows matching userId/ownerId", () => {
    expect(canAccess("member", "individual_only", "user-1", "user-1")).toBe(true);
  });

  it("individual_only tier denies mismatched userId/ownerId", () => {
    expect(canAccess("founder", "individual_only", "user-1", "user-2")).toBe(false);
  });

  it("individual_only tier denies when only one of userId/ownerId is undefined", () => {
    expect(canAccess("founder", "individual_only", undefined, "user-1")).toBe(false);
    expect(canAccess("founder", "individual_only", "user-1", undefined)).toBe(false);
  });

  it("individual_only tier allows when both userId and ownerId are undefined (both equal)", () => {
    expect(canAccess("founder", "individual_only")).toBe(true);
  });
});
