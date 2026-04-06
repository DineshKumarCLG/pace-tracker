import { describe, it, expect, beforeEach } from "vitest";
import { useTeamStore } from "./teamStore";
import type { TeamMember } from "@/types";

const mockMember: TeamMember = {
  userId: "u1",
  name: "Alice",
  status: "active",
  currentTask: "Build UI",
  sessionStart: 1700000000,
  breakStart: null,
  outputNote: null,
  avatarColor: "#6e6af6",
};

describe("teamStore", () => {
  beforeEach(() => {
    useTeamStore.setState({ members: {} });
  });

  it("updateMember adds a new member", () => {
    useTeamStore.getState().updateMember("u1", mockMember);
    expect(useTeamStore.getState().members["u1"]).toEqual(mockMember);
  });

  it("updateMember updates an existing member's status", () => {
    useTeamStore.getState().updateMember("u1", mockMember);
    useTeamStore.getState().updateMember("u1", { status: "on_break" });
    expect(useTeamStore.getState().members["u1"].status).toBe("on_break");
    expect(useTeamStore.getState().members["u1"].name).toBe("Alice");
  });

  it("removeMember removes a member", () => {
    useTeamStore.getState().updateMember("u1", mockMember);
    useTeamStore.getState().removeMember("u1");
    expect(useTeamStore.getState().members["u1"]).toBeUndefined();
  });

  it("clearMembers empties all members", () => {
    useTeamStore.getState().updateMember("u1", mockMember);
    useTeamStore.getState().updateMember("u2", { ...mockMember, userId: "u2", name: "Bob" });
    useTeamStore.getState().clearMembers();
    expect(Object.keys(useTeamStore.getState().members)).toHaveLength(0);
  });

  it("removeMember on non-existent member does not throw or corrupt state", () => {
    useTeamStore.getState().updateMember("u1", mockMember);
    useTeamStore.getState().removeMember("u999");
    // u1 should still be intact
    expect(useTeamStore.getState().members["u1"]).toEqual(mockMember);
    expect(useTeamStore.getState().members["u999"]).toBeUndefined();
  });

  it("updating one member does not affect another member", () => {
    const bob: TeamMember = { ...mockMember, userId: "u2", name: "Bob", status: "offline" };
    useTeamStore.getState().updateMember("u1", mockMember);
    useTeamStore.getState().updateMember("u2", bob);

    useTeamStore.getState().updateMember("u1", { status: "away" });

    expect(useTeamStore.getState().members["u1"].status).toBe("away");
    expect(useTeamStore.getState().members["u2"].status).toBe("offline");
    expect(useTeamStore.getState().members["u2"].name).toBe("Bob");
  });
});
