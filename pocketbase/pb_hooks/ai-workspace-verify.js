/**
 * AI Workspace Photo Verification Hook
 *
 * On workspace_proofs record create: sends photo to LiteLLM vision endpoint
 * to verify the photo shows a workspace/desk/office environment.
 *
 * Sets aiVerified = yes/no/unavailable. Never blocks session start/end.
 * Rate limit: max 1 verification per proof record (no retries on failure).
 *
 * Requirements: Task 18.9
 */

onRecordAfterCreateSuccess((e) => {
  const record = e.record;

  // Only process workspace_proofs
  if (!record) return;

  const LITELLM_URL = $os.getenv("LITELLM_URL") || "http://litellm:4000";
  const LITELLM_KEY = $os.getenv("LITELLM_API_KEY") || "";
  const MODEL = $os.getenv("LITELLM_VISION_MODEL") || "gpt-4o-mini";

  // Get the photo file URL
  const photoField = record.get("photo");
  if (!photoField) {
    // No photo attached — mark as unavailable
    record.set("aiVerified", "unavailable");
    record.set("aiReason", "No photo attached");
    $app.save(record);
    return;
  }

  try {
    const photoUrl = $app.settings().meta.appURL +
      "/api/files/workspace_proofs/" + record.id + "/" + photoField;

    const requestBody = JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Is this a photo of a workspace, desk, or office environment? Reply with JSON only: {"verified": true/false, "reason": "brief explanation"}',
            },
            {
              type: "image_url",
              image_url: { url: photoUrl },
            },
          ],
        },
      ],
      max_tokens: 150,
      temperature: 0.1,
    });

    const res = $http.send({
      url: LITELLM_URL + "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + LITELLM_KEY,
      },
      body: requestBody,
      timeout: 30,
    });

    if (res.statusCode !== 200) {
      record.set("aiVerified", "unavailable");
      record.set("aiReason", "LLM returned status " + res.statusCode);
      $app.save(record);
      return;
    }

    const data = res.json;
    const content = data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (!content) {
      record.set("aiVerified", "unavailable");
      record.set("aiReason", "Empty LLM response");
      $app.save(record);
      return;
    }

    // Parse the JSON response from the LLM
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        record.set("aiVerified", "unavailable");
        record.set("aiReason", "Could not parse LLM response");
        $app.save(record);
        return;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      record.set("aiVerified", parsed.verified ? "yes" : "no");
      record.set("aiReason", parsed.reason || "No reason provided");
    } catch (parseErr) {
      record.set("aiVerified", "unavailable");
      record.set("aiReason", "Failed to parse LLM JSON: " + parseErr.message);
    }

    $app.save(record);
  } catch (err) {
    // LLM unavailable — set unavailable, never block
    try {
      record.set("aiVerified", "unavailable");
      record.set("aiReason", "LLM error: " + (err.message || "unknown"));
      $app.save(record);
    } catch (_saveErr) {
      // Silently fail — AI verification is advisory only
    }
  }
}, "workspace_proofs");
