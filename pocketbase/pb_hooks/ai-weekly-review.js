/// <reference path="../pb_data/types.d.ts" />

/**
 * POST /api/generate-review
 *
 * Generates an AI weekly review narrative for a user.
 * Queries week data from PocketBase, builds a structured prompt,
 * calls LiteLLM server-side (API keys never leave the server),
 * and stores the narrative in weekly_reviews.
 *
 * Body: { userId: string, weekStart: number, model?: string }
 * Returns: { narrative: string }
 */
routerAdd("POST", "/api/generate-review", (c) => {
  const body = $apis.requestInfo(c).data;
  const userId = body.userId;
  const weekStart = body.weekStart;
  const model = body.model || "gemini-flash";

  if (!userId || !weekStart) {
    return c.json(400, { error: "userId and weekStart are required" });
  }

  const weekEnd = weekStart + 7 * 24 * 3600;

  // Query completed sessions for the week (endTime must be non-null)
  const sessions = arrayOf(
    new DynamicModel({ id: "", startTime: 0, endTime: 0, outputNote: "" })
  );
  $app.dao().db()
    .select("id", "startTime", "endTime", "outputNote")
    .from("sessions")
    .where($dbx.exp("userId = {:uid}", { uid: userId }))
    .andWhere($dbx.exp("endTime IS NOT NULL"))
    .andWhere($dbx.exp("startTime >= {:ws}", { ws: weekStart }))
    .andWhere($dbx.exp("endTime <= {:we}", { we: weekEnd }))
    .all(sessions);

  // Query tasks closed this week
  const tasks = arrayOf(
    new DynamicModel({ id: "", title: "", projectId: "", closedAt: 0 })
  );
  $app.dao().db()
    .select("id", "title", "projectId", "closedAt")
    .from("tasks")
    .where($dbx.exp("status = 'done'"))
    .andWhere($dbx.exp("closedAt >= {:ws}", { ws: weekStart }))
    .andWhere($dbx.exp("closedAt <= {:we}", { we: weekEnd }))
    .all(tasks);

  // Query breaks for these sessions
  const sessionIds = sessions.map((s) => s.id);
  const breaks = arrayOf(
    new DynamicModel({ id: "", type: "", startTime: 0, endTime: 0 })
  );
  if (sessionIds.length > 0) {
    $app.dao().db()
      .select("id", "type", "startTime", "endTime")
      .from("breaks")
      .where($dbx.exp("sessionId IN {:ids}", { ids: sessionIds }))
      .all(breaks);
  }

  // Collect output notes
  const outputNotes = sessions
    .filter((s) => s.outputNote)
    .map((s) => s.outputNote);

  // Build prompt — tone: direct, non-judgmental, factual
  // No productivity scores or member comparisons
  const prompt = `You are a work reflection assistant for a small dev team. Write a concise weekly review narrative.

Tone: direct, non-judgmental, factual. Do NOT include productivity scores, rankings, or comparisons between team members.

Data for the week (${new Date(weekStart * 1000).toISOString().split("T")[0]} to ${new Date(weekEnd * 1000).toISOString().split("T")[0]}):

Sessions: ${sessions.length} completed sessions
Tasks closed: ${tasks.length} (${tasks.map((t) => t.title).join(", ") || "none"})
Breaks: ${breaks.length}
Output notes: ${outputNotes.join(" | ") || "none"}

Include:
1. Top project by time
2. Tasks closed summary
3. Gaps or patterns observed
4. One suggested priority for next week

Keep it under 200 words.`;

  // Call LiteLLM proxy — API key resolved from server environment
  const litellmUrl = $os.getenv("LITELLM_URL") || "http://localhost:4000";
  const litellmKey = $os.getenv("LITELLM_MASTER_KEY") || "";

  let narrative = "";
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
        max_tokens: 500,
        temperature: 0.7,
      }),
      timeout: 30,
    });

    const parsed = JSON.parse(res.raw);
    narrative = parsed.choices?.[0]?.message?.content || "";
  } catch (err) {
    return c.json(503, { error: "AI unavailable", details: String(err) });
  }

  // Store narrative in weekly_reviews
  try {
    const existing = arrayOf(new DynamicModel({ id: "" }));
    $app.dao().db()
      .select("id")
      .from("weekly_reviews")
      .where($dbx.exp("userId = {:uid}", { uid: userId }))
      .andWhere($dbx.exp("weekStart = {:ws}", { ws: weekStart }))
      .all(existing);

    if (existing.length > 0) {
      $app.dao().db()
        .newQuery("UPDATE weekly_reviews SET aiNarrative = {:n} WHERE id = {:id}")
        .bind({ n: narrative, id: existing[0].id })
        .execute();
    }
  } catch (_) {
    // Non-fatal: narrative still returned to client
  }

  return c.json(200, { narrative: narrative });
});
