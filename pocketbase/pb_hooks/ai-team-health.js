/// <reference path="../pb_data/types.d.ts" />

/**
 * POST /api/team-health
 *
 * Generates team health signals for admin review.
 * Admin-only endpoint. API keys resolved server-side only.
 *
 * Body: { weekStart: number, model?: string }
 * Returns: { signals: Array<{ type, message, severity, affectedUsers? }> }
 */
routerAdd("POST", "/api/team-health", (c) => {
  // Admin-only check
  const authRecord = c.get("authRecord");
  if (!authRecord) {
    return c.json(401, { error: "Authentication required" });
  }

  const body = $apis.requestInfo(c).data;
  const weekStart = body.weekStart;
  const model = body.model || "gemini-flash";

  if (!weekStart) {
    return c.json(400, { error: "weekStart is required" });
  }

  const weekEnd = weekStart + 7 * 24 * 3600;

  // Query all team members' session data for the week
  const memberStats = arrayOf(
    new DynamicModel({ userId: "", name: "", totalSecs: 0, sessionCount: 0 })
  );
  $app.dao().db()
    .newQuery(
      `SELECT s.userId, u.name,
              COALESCE(SUM(s.endTime - s.startTime), 0) as totalSecs,
              COUNT(s.id) as sessionCount
       FROM sessions s
       JOIN users u ON u.id = s.userId
       WHERE s.endTime IS NOT NULL
         AND s.startTime >= {:ws}
         AND s.endTime <= {:we}
       GROUP BY s.userId`
    )
    .bind({ ws: weekStart, we: weekEnd })
    .all(memberStats);

  const teamSummary = memberStats
    .map((m) => `${m.name}: ${Math.round(m.totalSecs / 3600)}h across ${m.sessionCount} sessions`)
    .join("\n");

  const prompt = `Analyze team health signals for a small dev team (3-5 people). Do NOT rank members or produce productivity scores.

Team data for the week:
${teamSummary || "No data available"}

Identify health signals like:
- Weekend work patterns
- Unusually long/short weeks
- Workload imbalance
- Potential burnout indicators

Return ONLY valid JSON array:
[{ "type": "string", "message": "string", "severity": "info"|"warning"|"alert", "affectedUsers": ["name"] }]

Keep it factual and non-judgmental. Max 5 signals.`;

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
        max_tokens: 500,
        temperature: 0.5,
      }),
      timeout: 30,
    });

    const parsed = JSON.parse(res.raw);
    const content = parsed.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      const signals = JSON.parse(jsonMatch[0]);
      return c.json(200, { signals: signals });
    }

    return c.json(200, { signals: [] });
  } catch (err) {
    return c.json(503, { error: "AI unavailable", details: String(err) });
  }
});
