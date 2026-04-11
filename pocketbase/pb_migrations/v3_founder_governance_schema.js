/// <reference path="../pb_data/types.d.ts" />

/**
 * PocketBase migration: v3 Founder Governance schema
 *
 * Adds synced collections for PACE v3 founder governance.
 * Collections: review_cycles, founder_reviews, accountability_warnings,
 * equity_stakes, dilution_events, decisions
 *
 * Excluded (local-only, never synced): startup_health_config
 *
 * Drops legacy collections: mood_checks, meetings, standup_responses, morning_digests
 */

migrate(
  (app) => {
    // --- Drop legacy collections ---
    const legacyCollections = ["mood_checks", "meetings", "standup_responses", "morning_digests"];
    for (const name of legacyCollections) {
      try {
        const col = app.findCollectionByNameOrId(name);
        if (col) {
          app.delete(col);
        }
      } catch (_) {
        // Collection doesn't exist, skip
      }
    }

    // --- review_cycles ---
    const reviewCycles = new Collection({
      name: "review_cycles",
      type: "base",
      fields: [
        { name: "startDate", type: "number", required: true },
        { name: "endDate", type: "number", required: true },
        { name: "submissionDeadline", type: "number", required: true },
        { name: "status", type: "select", required: true, options: { values: ["open", "closed", "resolved"] } },
        { name: "resolvedAt", type: "number" },
      ],
    });
    app.save(reviewCycles);

    // --- founder_reviews ---
    const founderReviews = new Collection({
      name: "founder_reviews",
      type: "base",
      fields: [
        { name: "cycleId", type: "relation", required: true, options: { collectionId: reviewCycles.id, maxSelect: 1 } },
        { name: "reviewerId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "revieweeId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "outputScore", type: "number", required: true },
        { name: "reliabilityScore", type: "number", required: true },
        { name: "initiativeScore", type: "number", required: true },
        { name: "submittedAt", type: "number", required: true },
      ],
    });
    app.save(founderReviews);

    // --- accountability_warnings ---
    const accountabilityWarnings = new Collection({
      name: "accountability_warnings",
      type: "base",
      fields: [
        { name: "founderId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "cycleId", type: "relation", required: true, options: { collectionId: reviewCycles.id, maxSelect: 1 } },
        { name: "issuedAt", type: "number", required: true },
        { name: "acknowledged", type: "bool" },
      ],
    });
    app.save(accountabilityWarnings);

    // --- equity_stakes ---
    const equityStakes = new Collection({
      name: "equity_stakes",
      type: "base",
      fields: [
        { name: "founderId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "initialStakePct", type: "number", required: true },
        { name: "currentStakePct", type: "number", required: true },
        { name: "vestingStartDate", type: "number", required: true },
        { name: "cliffDate", type: "number", required: true },
        { name: "vestingEndDate", type: "number", required: true },
        { name: "vestingScheduleMonths", type: "number", required: true },
        { name: "updatedAt", type: "number", required: true },
      ],
    });
    app.save(equityStakes);

    // --- dilution_events ---
    const dilutionEvents = new Collection({
      name: "dilution_events",
      type: "base",
      fields: [
        { name: "founderId", type: "relation", required: true, options: { collectionId: "_pb_users_auth_", maxSelect: 1 } },
        { name: "cycleId", type: "relation", required: true, options: { collectionId: reviewCycles.id, maxSelect: 1 } },
        { name: "dilutionPct", type: "number", required: true },
        { name: "previousStakePct", type: "number", required: true },
        { name: "newStakePct", type: "number", required: true },
        { name: "redistributionDetails", type: "text", required: true },
      ],
    });
    app.save(dilutionEvents);

    // --- decisions ---
    const decisions = new Collection({
      name: "decisions",
      type: "base",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "description", type: "text" },
        { name: "resolvedAt", type: "number" },
      ],
    });
    app.save(decisions);
  },

  // Rollback
  (app) => {
    const collections = [
      "decisions",
      "dilution_events",
      "equity_stakes",
      "accountability_warnings",
      "founder_reviews",
      "review_cycles",
    ];
    for (const name of collections) {
      try {
        const col = app.findCollectionByNameOrId(name);
        if (col) {
          app.delete(col);
        }
      } catch (_) {
        // Collection doesn't exist, skip
      }
    }
  },
);
