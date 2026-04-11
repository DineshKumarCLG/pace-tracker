/// <reference path="../pb_data/types.d.ts" />

/**
 * PocketBase migration: v2 Team Ops schema
 *
 * Adds synced collections for PACE v2 team operations.
 * Collections: leave_requests, public_holidays, milestones, milestone_tasks,
 * daily_reports
 *
 * Excluded (private, local-only): mood_checks, focus_score_history
 * Already exist in initial_schema.js: teams, team_members
 */

migrate(
  (app) => {
    // --- leave_requests ---
    const leaveRequests = new Collection({
      name: "leave_requests",
      type: "base",
      fields: [
        { name: "requesterId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "type", type: "select", required: true, options: { values: ["annual", "sick", "wfh"] } },
        { name: "startDate", type: "number", required: true },
        { name: "endDate", type: "number", required: true },
        { name: "reason", type: "text" },
        { name: "status", type: "select", required: true, options: { values: ["pending", "approved", "declined"] } },
        { name: "reviewerId", type: "relation", options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "reviewReason", type: "text" },
        { name: "updatedAt", type: "number" },
      ],
    });
    app.save(leaveRequests);

    // --- public_holidays ---
    const publicHolidays = new Collection({
      name: "public_holidays",
      type: "base",
      fields: [
        { name: "date", type: "number", required: true },
        { name: "name", type: "text", required: true },
        { name: "year", type: "number", required: true },
      ],
    });
    app.save(publicHolidays);

    // Look up existing collections for relation references
    const projects = app.findCollectionByNameOrId("projects");
    const tasks = app.findCollectionByNameOrId("tasks");
    const breaks = app.findCollectionByNameOrId("breaks");
    const sessions = app.findCollectionByNameOrId("sessions");

    // --- milestones ---
    const milestones = new Collection({
      name: "milestones",
      type: "base",
      fields: [
        { name: "projectId", type: "relation", required: true, options: { collectionId: projects.id, maxSelect: 1 } },
        { name: "name", type: "text", required: true },
        { name: "deadline", type: "number", required: true },
        { name: "completedAt", type: "number" },
        { name: "createdBy", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
      ],
    });
    app.save(milestones);

    // --- milestone_tasks ---
    const milestoneTasks = new Collection({
      name: "milestone_tasks",
      type: "base",
      fields: [
        { name: "milestoneId", type: "relation", required: true, options: { collectionId: milestones.id, maxSelect: 1 } },
        { name: "taskId", type: "relation", required: true, options: { collectionId: tasks.id, maxSelect: 1 } },
      ],
    });
    app.save(milestoneTasks);

    // --- daily_reports ---
    const dailyReports = new Collection({
      name: "daily_reports",
      type: "base",
      fields: [
        { name: "userId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "sessionId", type: "relation", required: true, options: { collectionId: sessions.id, maxSelect: 1 } },
        { name: "date", type: "text", required: true },
        { name: "reportJson", type: "text", required: true },
      ],
    });
    app.save(dailyReports);

    // --- workspace_proofs ---
    const workspaceProofs = new Collection({
      name: "workspace_proofs",
      type: "base",
      fields: [
        { name: "sessionId", type: "relation", required: true, options: { collectionId: sessions.id, maxSelect: 1 } },
        { name: "userId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "type", type: "select", required: true, options: { values: ["checkin", "checkout"] } },
        { name: "photo", type: "file", options: { maxSelect: 1, maxSize: 524288 } },
        { name: "photoHash", type: "text" },
        { name: "lat", type: "number" },
        { name: "lng", type: "number" },
        { name: "accuracy", type: "number" },
        { name: "locationId", type: "text" },
        { name: "aiVerified", type: "select", options: { values: ["yes", "no", "pending", "unavailable"] } },
        { name: "aiReason", type: "text" },
        { name: "exifTimestamp", type: "number" },
      ],
    });
    app.save(workspaceProofs);

    // --- workspace_locations ---
    const workspaceLocations = new Collection({
      name: "workspace_locations",
      type: "base",
      fields: [
        { name: "userId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "name", type: "text", required: true },
        { name: "lat", type: "number", required: true },
        { name: "lng", type: "number", required: true },
        { name: "radiusMeters", type: "number", required: true },
        { name: "isOfficeZone", type: "bool" },
      ],
    });
    app.save(workspaceLocations);

    // --- office_zones ---
    const officeZones = new Collection({
      name: "office_zones",
      type: "base",
      fields: [
        { name: "teamId", type: "text", required: true },
        { name: "name", type: "text", required: true },
        { name: "lat", type: "number", required: true },
        { name: "lng", type: "number", required: true },
        { name: "radiusMeters", type: "number", required: true },
        { name: "createdBy", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
      ],
    });
    app.save(officeZones);
  },

  // Rollback
  (app) => {
    const collections = [
      "office_zones",
      "workspace_locations",
      "workspace_proofs",
      "daily_reports",
      "milestone_tasks",
      "milestones",
      "public_holidays",
      "leave_requests",
    ];
    for (const name of collections) {
      const col = app.findCollectionByNameOrId(name);
      if (col) {
        app.delete(col);
      }
    }
  },
);
