/// <reference path="../pb_data/types.d.ts" />

/**
 * POST /api/smart-leave-suggest
 *
 * AI-powered conflict detection and alternative date suggestions
 * for leave requests. Detects:
 * - Other team members on leave during the requested dates
 * - Milestone deadlines within 3 days of the requested range
 * - Low team availability (below 50%)
 *
 * AI suggestions for alternative dates via LiteLLM (graceful fallback).
 * Conflicts are advisory only — never block submission.
 *
 * Body: { requesterId: string, startDate: number, endDate: number, model?: string }
 * Returns: { conflicts: Array<{ type, description }>, aiSuggestions: Array | null }
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4
 */
routerAdd("POST", "/api/smart-leave-suggest", (c) => {
  const body = $apis.requestInfo(c).data;
  const requesterId = body.requesterId;
  const startDate = body.startDate;
  const endDate = body.endDate;
  const model = body.model || "gemini-flash";

  if (!requesterId || !startDate || !endDate) {
    return c.json(400, { error: "requesterId, startDate, and endDate are required" });
  }

  const conflicts = [];

  // --- 1. Detect other team members on approved leave overlapping the range ---
  const overlappingLeave = arrayOf(
    new DynamicModel({ requesterId: "", startDate: 0, endDate: 0, type: "", userName: "" })
  );
  try {
    $app.dao().db()
      .newQuery(
        `SELECT lr.requesterId, lr.startDate, lr.endDate, lr.type, u.name as userName
         FROM leave_requests lr
         JOIN users u ON u.id = lr.requesterId
         WHERE lr.status = 'approved'
           AND lr.requesterId != {:rid}
           AND lr.startDate <= {:ed}
           AND lr.endDate >= {:sd}
           AND lr.type IN ('annual', 'sick')`
      )
      .bind({ rid: requesterId, sd: startDate, ed: endDate })
      .all(overlappingLeave);
  } catch (_) {
    // Query failed — continue without this check
  }

  for (const leave of overlappingLeave) {
    conflicts.push({
      type: "team_member_on_leave",
      description: leave.userName + " is on " + leave.type + " leave during this period",
    });
  }

  // --- 2. Detect milestone deadlines within 3 days of the requested range ---
  const THREE_DAYS = 3 * 86400;
  const milestoneStart = startDate - THREE_DAYS;
  const milestoneEnd = endDate + THREE_DAYS;

  const nearbyMilestones = arrayOf(
    new DynamicModel({ id: "", name: "", deadline: 0, projectId: "" })
  );
  try {
    $app.dao().db()
      .select("id", "name", "deadline", "projectId")
      .from("milestones")
      .where($dbx.exp("completedAt IS NULL"))
      .andWhere($dbx.exp("deadline >= {:ms}", { ms: milestoneStart }))
      .andWhere($dbx.exp("deadline <= {:me}", { me: milestoneEnd }))
      .all(nearbyMilestones);
  } catch (_) {
    // Query failed — continue without this check
  }

  for (const ms of nearbyMilestones) {
    const deadlineDate = new Date(ms.deadline * 1000).toISOString().split("T")[0];
    conflicts.push({
      type: "milestone_deadline",
      description: "Milestone \"" + ms.name + "\" has a deadline on " + deadlineDate,
    });
  }

  // --- 3. Detect low team availability (below 50%) ---
  const teamMembers = arrayOf(new DynamicModel({ id: "" }));
  try {
    $app.dao().db()
      .select("id")
      .from("users")
      .all(teamMembers);
  } catch (_) {
    // Query failed — skip availability check
  }

  if (teamMembers.length > 0) {
    // Count how many other members have approved leave overlapping the range
    const onLeaveCount = overlappingLeave.length;
    // The requester would also be on leave
    const totalOnLeave = onLeaveCount + 1;
    const totalMembers = teamMembers.length;
    const availableCount = totalMembers - totalOnLeave;

    if (totalMembers > 0 && availableCount / totalMembers < 0.5) {
      conflicts.push({
        type: "low_availability",
        description: "Team availability would drop below 50% (" + availableCount + " of " + totalMembers + " available)",
      });
    }
  }

  // --- 4. AI suggestions for alternative dates (graceful fallback) ---
  let aiSuggestions = null;

  if (conflicts.length > 0) {
    const litellmUrl = $os.getenv("LITELLM_URL") || "http://localhost:4000";
    const litellmKey = $os.getenv("LITELLM_MASTER_KEY") || "";

    const startStr = new Date(startDate * 1000).toISOString().split("T")[0];
    const endStr = new Date(endDate * 1000).toISOString().split("T")[0];

    const conflictSummary = conflicts
      .map((c) => "- " + c.description)
      .join("\n");

    const prompt = `You are a scheduling assistant for a small dev team (3-5 people). A team member wants to take leave from ${startStr} to ${endStr}, but there are conflicts:

${conflictSummary}

Suggest 2-3 alternative date ranges (within 2 weeks of the original dates) that would minimize team impact. Consider weekdays only.

Return ONLY valid JSON array:
[{"startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "reason": "brief explanation"}]

Keep suggestions practical and concise.`;

    try {
      const res = $http.send({
        url: litellmUrl + "/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + litellmKey,
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 400,
          temperature: 0.5,
        }),
        timeout: 30,
      });

      const parsed = JSON.parse(res.raw);
      const content = parsed.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]);
        // Convert date strings to UTC timestamps
        aiSuggestions = suggestions.map((s) => {
          const sd = new Date(s.startDate + "T00:00:00Z");
          const ed = new Date(s.endDate + "T00:00:00Z");
          return {
            startDate: Math.floor(sd.getTime() / 1000),
            endDate: Math.floor(ed.getTime() / 1000),
            reason: s.reason || "",
          };
        });
      }
    } catch (_) {
      // AI unavailable — aiSuggestions stays null (Req 21.3)
    }
  }

  // Conflicts are advisory only, never block submission (Req 21.4)
  return c.json(200, {
    conflicts: conflicts,
    aiSuggestions: aiSuggestions,
  });
});
