/// <reference path="../pb_data/types.d.ts" />

/**
 * PocketBase migration: Initial schema
 *
 * Creates all collections mirroring the local SQLite schema.
 * Collections: users (extends auth), projects, tasks, sessions,
 * session_tasks, breaks, idle_events, git_events, weekly_reviews, settings
 */

migrate(
  (app) => {
    // --- projects ---
    const projects = new Collection({
      name: "projects",
      type: "base",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "color", type: "text" },
        { name: "createdBy", type: "relation", options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "archivedAt", type: "number" },
      ],
    });
    app.save(projects);

    // --- tasks ---
    const tasks = new Collection({
      name: "tasks",
      type: "base",
      fields: [
        { name: "projectId", type: "relation", required: true, options: { collectionId: projects.id, maxSelect: 1 } },
        { name: "title", type: "text", required: true },
        { name: "status", type: "select", required: true, options: { values: ["open", "inprogress", "done", "blocked"] } },
        { name: "assigneeId", type: "relation", options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "priority", type: "select", required: true, options: { values: ["high", "medium", "low"] } },
        { name: "dueDate", type: "number" },
        { name: "estimatedMinutes", type: "number" },
        { name: "notes", type: "text" },
        { name: "createdBy", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "closedAt", type: "number" },
      ],
    });
    app.save(tasks);

    // --- sessions ---
    const sessions = new Collection({
      name: "sessions",
      type: "base",
      fields: [
        { name: "userId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "startTime", type: "number", required: true },
        { name: "endTime", type: "number" },
        { name: "startType", type: "select", required: true, options: { values: ["manual", "backfill", "recovered"] } },
        { name: "startVerified", type: "bool" },
        { name: "outputNote", type: "text" },
        { name: "lastHeartbeat", type: "number" },
        { name: "syncedAt", type: "number" },
      ],
    });
    app.save(sessions);

    // --- session_tasks ---
    const sessionTasks = new Collection({
      name: "session_tasks",
      type: "base",
      fields: [
        { name: "sessionId", type: "relation", required: true, options: { collectionId: sessions.id, maxSelect: 1 } },
        { name: "taskId", type: "relation", required: true, options: { collectionId: tasks.id, maxSelect: 1 } },
        { name: "startTime", type: "number", required: true },
        { name: "endTime", type: "number" },
      ],
    });
    app.save(sessionTasks);

    // --- breaks ---
    const breaks = new Collection({
      name: "breaks",
      type: "base",
      fields: [
        { name: "sessionId", type: "relation", required: true, options: { collectionId: sessions.id, maxSelect: 1 } },
        { name: "startTime", type: "number", required: true },
        { name: "endTime", type: "number" },
        { name: "type", type: "select", required: true, options: { values: ["lunch", "short", "meeting", "discarded"] } },
        { name: "autoDetected", type: "bool" },
      ],
    });
    app.save(breaks);

    // --- idle_events ---
    const idleEvents = new Collection({
      name: "idle_events",
      type: "base",
      fields: [
        { name: "sessionId", type: "relation", required: true, options: { collectionId: sessions.id, maxSelect: 1 } },
        { name: "startTime", type: "number", required: true },
        { name: "endTime", type: "number" },
        { name: "resolution", type: "select", required: true, options: { values: ["lunch", "short", "meeting", "discarded", "pending"] } },
      ],
    });
    app.save(idleEvents);

    // --- git_events ---
    const gitEvents = new Collection({
      name: "git_events",
      type: "base",
      fields: [
        { name: "sessionId", type: "relation", options: { collectionId: sessions.id, maxSelect: 1 } },
        { name: "userId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "repoPath", type: "text", required: true },
        { name: "commitHash", type: "text", required: true },
        { name: "message", type: "text" },
        { name: "commitTime", type: "number", required: true },
      ],
    });
    app.save(gitEvents);

    // --- weekly_reviews ---
    const weeklyReviews = new Collection({
      name: "weekly_reviews",
      type: "base",
      fields: [
        { name: "userId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "weekStart", type: "number", required: true },
        { name: "weekEnd", type: "number", required: true },
        { name: "aiNarrative", type: "text" },
        { name: "nextPriority", type: "text" },
        { name: "savedAt", type: "number" },
      ],
    });
    app.save(weeklyReviews);

    // --- settings ---
    const settings = new Collection({
      name: "settings",
      type: "base",
      fields: [
        { name: "userId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1, cascadeDelete: true } },
        { name: "theme", type: "select", required: true, options: { values: ["light", "dark", "system"] } },
        { name: "idleThresholdMin", type: "number", required: true },
        { name: "nudgeIntervalMin", type: "number", required: true },
        { name: "breakCapMin", type: "number", required: true },
        { name: "weeklyReviewDay", type: "number", required: true },
        { name: "weeklyReviewHour", type: "number", required: true },
        { name: "autoPauseOnLock", type: "bool" },
        { name: "autoPauseOnSleep", type: "bool" },
        { name: "litellmUrl", type: "text" },
        { name: "litellmModel", type: "text" },
        { name: "litellmApiKey", type: "text" },
        { name: "aiEnabled", type: "bool" },
        { name: "gitRepoPaths", type: "json" },
      ],
    });
    app.save(settings);

    // --- teams ---
    const teams = new Collection({
      name: "teams",
      type: "base",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "inviteCode", type: "text", required: true },
        { name: "createdBy", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
      ],
    });
    app.save(teams);

    // --- team_members ---
    const teamMembers = new Collection({
      name: "team_members",
      type: "base",
      fields: [
        { name: "teamId", type: "relation", required: true, options: { collectionId: teams.id, maxSelect: 1 } },
        { name: "userId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
      ],
    });
    app.save(teamMembers);
  },

  // Rollback
  (app) => {
    const collections = [
      "team_members",
      "teams",
      "settings",
      "weekly_reviews",
      "git_events",
      "idle_events",
      "breaks",
      "session_tasks",
      "sessions",
      "tasks",
      "projects",
    ];
    for (const name of collections) {
      const col = app.findCollectionByNameOrId(name);
      if (col) {
        app.delete(col);
      }
    }
  },
);
