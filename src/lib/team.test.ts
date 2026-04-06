import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateInviteCode } from "@/lib/db";

// Mock PocketBase
const mockCreate = vi.fn();
const mockGetList = vi.fn();
const mockGetFullList = vi.fn();
const mockGetOne = vi.fn();

vi.mock("@/lib/pocketbase", () => ({
  pb: {
    collection: vi.fn((name: string) => ({
      create: (...args: unknown[]) => mockCreate(name, ...args),
      getList: (...args: unknown[]) => mockGetList(name, ...args),
      getFullList: (...args: unknown[]) => mockGetFullList(name, ...args),
      getOne: (...args: unknown[]) => mockGetOne(name, ...args),
    })),
  },
}));

// Mock Tauri invoke (needed because db.ts imports it)
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("generateInviteCode", () => {
  it("returns an 8-character string", () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(8);
  });

  it("contains only allowed alphanumeric characters", () => {
    const allowed = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      for (const char of code) {
        expect(allowed).toContain(char);
      }
    }
  });

  it("excludes ambiguous characters (0, O, 1, l, I)", () => {
    const ambiguous = ["0", "O", "1", "l", "I"];
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode();
      for (const char of ambiguous) {
        expect(code).not.toContain(char);
      }
    }
  });

  it("generates unique codes across multiple calls", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateInviteCode());
    }
    // With 8 chars from 54-char alphabet, collisions in 100 codes are astronomically unlikely
    expect(codes.size).toBe(100);
  });
});

describe("createTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a team and adds creator as first member", async () => {
    const { createTeam } = await import("@/lib/db");

    mockCreate.mockImplementation((collection: string, data: Record<string, unknown>) => {
      if (collection === "teams") {
        return Promise.resolve({
          id: "team-1",
          name: data.name,
          inviteCode: data.inviteCode,
          createdBy: data.createdBy,
          created: "2025-01-01T00:00:00.000Z",
        });
      }
      if (collection === "team_members") {
        return Promise.resolve({
          id: "tm-1",
          teamId: data.teamId,
          userId: data.userId,
          created: "2025-01-01T00:00:00.000Z",
        });
      }
      return Promise.resolve({});
    });

    const team = await createTeam("Kenesis Labs", "user-1");

    expect(team.name).toBe("Kenesis Labs");
    expect(team.inviteCode).toHaveLength(8);
    expect(team.createdBy).toBe("user-1");
    expect(team.id).toBe("team-1");

    // Verify team was created in PocketBase
    expect(mockCreate).toHaveBeenCalledWith("teams", expect.objectContaining({
      name: "Kenesis Labs",
      createdBy: "user-1",
    }));

    // Verify creator was added as team member
    expect(mockCreate).toHaveBeenCalledWith("team_members", {
      teamId: "team-1",
      userId: "user-1",
    });
  });

  it("trims whitespace from team name", async () => {
    const { createTeam } = await import("@/lib/db");

    mockCreate.mockResolvedValue({
      id: "team-1",
      name: "Kenesis Labs",
      inviteCode: "ABC12345",
      createdBy: "user-1",
      created: "2025-01-01T00:00:00.000Z",
    });

    await createTeam("  Kenesis Labs  ", "user-1");

    expect(mockCreate).toHaveBeenCalledWith("teams", expect.objectContaining({
      name: "Kenesis Labs",
    }));
  });
});

describe("joinTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("joins a team by invite code", async () => {
    const { joinTeam } = await import("@/lib/db");

    mockGetList.mockImplementation((collection: string) => {
      if (collection === "teams") {
        return Promise.resolve({
          items: [{
            id: "team-1",
            name: "Kenesis Labs",
            inviteCode: "ABC12345",
            createdBy: "user-1",
            created: "2025-01-01T00:00:00.000Z",
          }],
        });
      }
      if (collection === "team_members") {
        return Promise.resolve({ items: [] });
      }
      return Promise.resolve({ items: [] });
    });

    mockCreate.mockResolvedValue({
      id: "tm-2",
      teamId: "team-1",
      userId: "user-2",
      created: "2025-01-01T00:00:00.000Z",
    });

    const team = await joinTeam("ABC12345", "user-2");

    expect(team.id).toBe("team-1");
    expect(team.name).toBe("Kenesis Labs");
    expect(mockCreate).toHaveBeenCalledWith("team_members", {
      teamId: "team-1",
      userId: "user-2",
    });
  });

  it("throws on invalid invite code", async () => {
    const { joinTeam } = await import("@/lib/db");

    mockGetList.mockResolvedValue({ items: [] });

    await expect(joinTeam("INVALID1", "user-2")).rejects.toThrow("Invalid invite code");
  });

  it("is idempotent — does not create duplicate membership", async () => {
    const { joinTeam } = await import("@/lib/db");

    mockGetList.mockImplementation((collection: string) => {
      if (collection === "teams") {
        return Promise.resolve({
          items: [{
            id: "team-1",
            name: "Kenesis Labs",
            inviteCode: "ABC12345",
            createdBy: "user-1",
            created: "2025-01-01T00:00:00.000Z",
          }],
        });
      }
      if (collection === "team_members") {
        // Already a member
        return Promise.resolve({
          items: [{
            id: "tm-1",
            teamId: "team-1",
            userId: "user-2",
            created: "2025-01-01T00:00:00.000Z",
          }],
        });
      }
      return Promise.resolve({ items: [] });
    });

    const team = await joinTeam("ABC12345", "user-2");

    expect(team.id).toBe("team-1");
    // Should NOT have called create for team_members since already a member
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("getTeamMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all members of a team", async () => {
    const { getTeamMembers } = await import("@/lib/db");

    mockGetFullList.mockResolvedValue([
      { teamId: "team-1", userId: "user-1", created: "2025-01-01T00:00:00.000Z" },
      { teamId: "team-1", userId: "user-2", created: "2025-01-02T00:00:00.000Z" },
    ]);

    const members = await getTeamMembers("team-1");

    expect(members).toHaveLength(2);
    expect(members[0].userId).toBe("user-1");
    expect(members[1].userId).toBe("user-2");
    expect(members[0].teamId).toBe("team-1");
  });

  it("returns empty array for team with no members", async () => {
    const { getTeamMembers } = await import("@/lib/db");

    mockGetFullList.mockResolvedValue([]);

    const members = await getTeamMembers("team-1");
    expect(members).toHaveLength(0);
  });
});

describe("getUserTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the team for a user who has one", async () => {
    const { getUserTeam } = await import("@/lib/db");

    mockGetList.mockResolvedValue({
      items: [{ teamId: "team-1", userId: "user-1", created: "2025-01-01T00:00:00.000Z" }],
    });

    mockGetOne.mockResolvedValue({
      id: "team-1",
      name: "Kenesis Labs",
      inviteCode: "ABC12345",
      createdBy: "user-1",
      created: "2025-01-01T00:00:00.000Z",
    });

    const team = await getUserTeam("user-1");

    expect(team).not.toBeNull();
    expect(team!.id).toBe("team-1");
    expect(team!.name).toBe("Kenesis Labs");
  });

  it("returns null for a user with no team", async () => {
    const { getUserTeam } = await import("@/lib/db");

    mockGetList.mockResolvedValue({ items: [] });

    const team = await getUserTeam("user-1");
    expect(team).toBeNull();
  });
});
