import { useState, useCallback } from "react";
import { FileText } from "lucide-react";
import { useSessionStore } from "@/stores/sessionStore";

export default function OutputNote() {
  const session = useSessionStore((s) => s.session);
  const setSession = useSessionStore((s) => s.setSession);
  const [localNote, setLocalNote] = useState(session?.outputNote ?? "");
  const [focused, setFocused] = useState(false);
  const editable = !!session && !session.endTime;

  const onChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setLocalNote(v);
    if (session) setSession({ ...session, outputNote: v || null });
  }, [session, setSession]);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5">
        <FileText className="h-3 w-3 text-muted-foreground/60" />
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Output</h3>
      </div>
      <div className={`rounded-xl transition-shadow duration-200 ${focused ? "shadow-[0_0_0_2px_hsl(var(--ring)/0.3)]" : ""}`}>
        <textarea
          className="w-full resize-none rounded-xl inset-well px-3.5 py-2.5 text-[13px] font-medium leading-relaxed placeholder:text-muted-foreground/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-35"
          rows={3}
          placeholder={editable ? "What did you ship today?" : "Start a session to write…"}
          value={localNote}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={!editable}
          aria-label="Output note"
        />
      </div>
    </div>
  );
}
