/// <reference path="../pb_data/types.d.ts" />

/**
 * POST /api/generate-standup
 *
 * Generates a standup summary from yesterday's completed sessions.
 * API keys resolved server-side only.
 *
 * Body: { userId: string, model?: string }
 * Returns: { standup: string }
 */
routerAdd("POST", "/api/generate-standup", (c) => {
  const body = $apis.requestInfo(c).data;
  const userId = body.userId;
  const model = body.model || "gemini-flash";

  if (!userId) {
    return c.json(400, { error: "userId is required" });
  }

  // Yesterday's time range
  const now = Math.floor(Date.now() / 1000);
  const todayStart = now - (now % 86400);
  const yesterdayStart = todayStart - 86400;
  const yesterdayEnd = todayStart;

  // Query yesterday's completed sessions
  const sessions = arrayOf(
    new DynamicModel({ id: "", startTime: 0, endTime: 0, outputNote: "" })
  );
  $app.dao().db()
    .select("id", "startTime", "endTime", "outputNote")
    .from("sessions")
    .where($dbx.exp("userId = {:uid}", { uid: userId }))
    .andWhere($dbx.exp("endTime IS NOT NULL"))
    .andWhere($dbx.exp("startTime >= {:ys}", { ys: yesterdayStart }))
    .andWhere($dbx.exp("endTime <= {:ye}", { ye: yesterdayEnd }))
    .all(sessions);

  // Query tasks touched yesterday
  const sessionIds = sessions.map((s) => s.id);
  const tasksTouched = arrayOf(
    new DynamicModel({ title: "" })
  );
  if (sessionIds.length > 0) {
    $app.dao().db()
      .select("DISTINCT t.title as title")
      .from("session_tasks st")
      .innerJoin("tasks t", $dbx.exp("st.taskId = t.id"))
      .where($dbx.exp("st.sessionId IN {:ids}", { ids: sessionIds }))
      .all(tasksTouched);
  }

  const outputNotes = sessions
    .filter((s) => s.outputNote)
    .map((s) => s.outputNote);

  const prompt = `Generate a brief standup update from yesterday's work data.

Sessions: ${sessions.length} completed
Tasks touched: ${tasksTouched.map((t) => t.title).join(", ") || "none"}
Output notes: ${outputNotes.join(" | ") || "none"}

Format:
- Yesterday: [what was done]
- Today: [suggested focus based on yesterday's work]
- Blockers: [any apparent blockers, or "none"]

Keep it under 100 words. Tone: direct, factual.`;

  const litellmUrl = $os.getenv("LITELLM_URL") || "http://localhost:4000";
  const litellmKey = $os.getenv("LITELLM_MASTER_KEY") || "";

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
        max_tokens: 300,
        temperature: 0.5,
      }),
      timeout: 30,
    });

    const parsed = JSON.parse(res.raw);
    const standup = parsed.choices?.[0]?.message?.content || "";
    return c.json(200, { standup: standup });
  } catch (err) {
    return c.json(503, { error: "AI unavailable", details: String(err) });
  }
});
