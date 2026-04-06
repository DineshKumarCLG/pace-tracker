import { useState, useEffect, useCallback } from "react";
import { Sparkles, Pencil, Check, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateWeeklyReview } from "@/lib/ai";
import { toast } from "sonner";

interface AIReviewDraftProps {
  userId: string;
  weekStart: number;
  aiEnabled: boolean;
}

type DraftState = "idle" | "loading" | "loaded" | "error";

/**
 * AIReviewDraft — Editable AI narrative card for the weekly review.
 *
 * Calls PocketBase /api/generate-review (no API keys in client).
 * If AI fails: shows review data without narrative + toast.
 */
export default function AIReviewDraft({
  userId,
  weekStart,
  aiEnabled,
}: AIReviewDraftProps) {
  const [narrative, setNarrative] = useState("");
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const [isEditing, setIsEditing] = useState(false);

  const fetchNarrative = useCallback(async () => {
    if (!aiEnabled || !userId) return;

    setDraftState("loading");
    const result = await generateWeeklyReview(userId, weekStart);

    if (result) {
      setNarrative(result);
      setDraftState("loaded");
    } else {
      setDraftState("error");
      toast.error("AI unavailable", {
        description: "Showing review data without narrative.",
      });
    }
  }, [userId, weekStart, aiEnabled]);

  useEffect(() => {
    fetchNarrative();
  }, [fetchNarrative]);

  if (!aiEnabled) return null;

  return (
    <div
      className="glass noise rounded-xl p-4 animate-slide-up"
      style={{ animationDelay: "240ms" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-widest">
            AI Review Draft
          </span>
        </div>

        {draftState === "loaded" && (
          <button
            onClick={() => {
              if (isEditing) {
                // Save — in production, persist to weekly_reviews.aiNarrative
                setIsEditing(false);
              } else {
                setIsEditing(true);
              }
            }}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1",
              "text-[11px] font-medium transition-colors",
              isEditing
                ? "text-primary hover:bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            )}
          >
            {isEditing ? (
              <>
                <Check className="h-3 w-3" />
                Save
              </>
            ) : (
              <>
                <Pencil className="h-3 w-3" />
                Edit draft
              </>
            )}
          </button>
        )}
      </div>

      {/* Content */}
      {draftState === "loading" && (
        <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-[13px]">Generating review…</span>
        </div>
      )}

      {draftState === "error" && (
        <div className="flex items-center gap-2 py-4 text-muted-foreground">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <span className="text-[13px]">
            AI unavailable — review data shown above.
          </span>
        </div>
      )}

      {draftState === "loaded" && (
        <textarea
          className={cn(
            "w-full rounded-lg px-3 py-2.5 text-[13px] leading-relaxed",
            "text-foreground resize-none focus:outline-none",
            isEditing
              ? "inset-well focus:ring-1 focus:ring-primary/40"
              : "bg-transparent cursor-default",
          )}
          rows={6}
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          readOnly={!isEditing}
          aria-label="AI review narrative"
        />
      )}

      {draftState === "idle" && null}
    </div>
  );
}
