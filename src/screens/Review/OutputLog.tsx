import { FileText } from "lucide-react";
import type { OutputNote } from "./reviewData";

interface OutputLogProps {
  notes: OutputNote[];
}

export default function OutputLog({ notes }: OutputLogProps) {
  return (
    <div
      className="glass noise rounded-xl p-4 animate-slide-up"
      style={{ animationDelay: "240ms" }}
    >
      <h3 className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Output Log
      </h3>
      {notes.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/60 italic">
          No output notes this week
        </p>
      ) : (
        <div className="space-y-2.5">
          {notes.map((note) => (
            <div key={note.date} className="flex gap-3">
              <div className="flex flex-col items-center pt-0.5">
                <FileText className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                <div className="w-px flex-1 bg-border/40 mt-1" />
              </div>
              <div className="pb-1 min-w-0">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  {note.dayLabel}
                </p>
                <p className="text-[12px] text-foreground/90 mt-0.5 leading-relaxed">
                  {note.note}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
