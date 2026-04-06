/// <reference path="../pb_data/types.d.ts" />

/**
 * POST /api/estimate-task
 *
 * Estimates effort for a task based on historical completed tasks.
 * API keys resolved server-side only.
 *
 * Body: { taskTitle: string, projectId: string, model?: string }
 * Returns: { minMinutes: number, maxMinutes: number, reasoning: string }
 */
routerAdd("POST", "/api/estimate-task", (c) => {
  const body = $apis.requestInfo(c).data;
  const taskTitle = body.taskTitle;
  const projectId = body.projectId;
  const model = body.model || "gemini-flash";

  if (!taskTitle) {
    return c.json(400, { error: "taskTitle is required" });
  }

  // Query last 30 completed tasks with actual time logged
  const completedTasks = arrayOf(
    new DynamicModel({ title: "", totalMinutes: 0 })
  );
  $app.dao().db()
    .newQuery(
      `SELECT t.title, COALESCE(SUM(st.endTime - st.startTime) / 60, 0) as totalMinutes
       FROM tasks t
       LEFT JOIN session_tasks st ON st.taskId = t.id AND st.endTime IS NOT NULL
       WHERE t.status = 'done'
       ${projectId ? "AND t.projectId = {:pid}" : ""}
       GROUP BY t.id
       ORDER BY t.closedAt DESC
       LIMIT 30`
    )
    .bind(projectId ? { pid: projectId } : {})
    .all(completedTasks);

  const historicalContext = completedTasks
    .map((t) => `"${t.title}" → ${t.totalMinutes}min`)
    .join("\n");

  const prompt = `Estimate effort for this task based on historical data.

Task: "${taskTitle}"
${projectId ? "Project: " + projectId : ""}

Historical completed tasks with actual time:
${historicalContext || "No historical data available"}

Return ONLY valid JSON:
{
  "minMinutes": <number>,
  "maxMinutes": <number>,
  "reasoning": "<one sentence>"
}`;

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
        max_tokens: 200,
        temperature: 0.3,
      }),
      timeout: 30,
    });

    const parsed = JSON.parse(res.raw);
    const content = parsed.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return c.json(200, {
        minMinutes: result.minMinutes || 30,
        maxMinutes: result.maxMinutes || 120,
        reasoning: result.reasoning || "Estimated based on similar tasks",
      });
    }

    return c.json(200, { minMinutes: 30, maxMinutes: 120, reasoning: "Default estimate" });
  } catch (err) {
    return c.json(503, { error: "AI unavailable", details: String(err) });
  }
});
