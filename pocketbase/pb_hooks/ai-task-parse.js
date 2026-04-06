/// <reference path="../pb_data/types.d.ts" />

/**
 * POST /api/parse-task
 *
 * Parses natural language text into structured task fields using AI.
 * API keys resolved server-side only — never from client request.
 *
 * Body: { text: string, projects: Array<{id,name}>, team: Array<{id,name}>, model?: string }
 * Returns: { title, projectId, assigneeId, priority, dueDate }
 */
routerAdd("POST", "/api/parse-task", (c) => {
  const body = $apis.requestInfo(c).data;
  const text = body.text;
  const projects = body.projects || [];
  const team = body.team || [];
  const model = body.model || "gemini-flash";

  if (!text) {
    return c.json(400, { error: "text is required" });
  }

  const today = new Date().toISOString().split("T")[0];

  const prompt = `Parse this natural language task description into structured fields.

Input: "${text}"

Available projects: ${JSON.stringify(projects.map((p) => ({ id: p.id, name: p.name })))}
Team members: ${JSON.stringify(team.map((t) => ({ id: t.id, name: t.name })))}
Today's date: ${today}

Return ONLY valid JSON with these fields:
{
  "title": "concise task title",
  "projectId": "matching project id or null",
  "assigneeId": "matching team member id or null",
  "priority": "high" | "medium" | "low",
  "dueDate": "YYYY-MM-DD or null"
}

Rules:
- Match project/assignee names fuzzy (e.g. "arjun" matches "Arjun")
- "urgent"/"asap"/"critical" → high priority
- "friday"/"next week"/relative dates → resolve to YYYY-MM-DD from today
- Default priority: medium
- If no match found for project/assignee, use null`;

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
        temperature: 0.2,
      }),
      timeout: 30,
    });

    const parsed = JSON.parse(res.raw);
    const content = parsed.choices?.[0]?.message?.content || "";

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return c.json(200, {
        title: text,
        projectId: null,
        assigneeId: null,
        priority: "medium",
        dueDate: null,
      });
    }

    const result = JSON.parse(jsonMatch[0]);
    return c.json(200, {
      title: result.title || text,
      projectId: result.projectId || null,
      assigneeId: result.assigneeId || null,
      priority: result.priority || "medium",
      dueDate: result.dueDate || null,
    });
  } catch (err) {
    // Parsing failed — return raw text as title (graceful fallback)
    return c.json(200, {
      title: text,
      projectId: null,
      assigneeId: null,
      priority: "medium",
      dueDate: null,
    });
  }
});
