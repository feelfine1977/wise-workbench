import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { cn } from "@/lib/utils";

/** Read-only JSON view on CodeMirror 6 (lazy-loaded); a <pre> fallback renders until the editor is ready. */
export function JsonView({ value, className, height = 520, ariaLabel = "Norm JSON" }: { value: unknown; className?: string; height?: number; ariaLabel?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const text = JSON.stringify(value, null, 2);

  useEffect(() => {
    let view: EditorView | undefined;
    let cancelled = false;
    void Promise.all([import("@codemirror/state"), import("@codemirror/view"), import("@codemirror/lang-json"), import("@codemirror/language"), import("@codemirror/commands"), import("@lezer/highlight")]).then(
      ([state, cmView, json, language, commands, highlight]) => {
        if (cancelled || !host.current) return;
        const style = language.HighlightStyle.define([
          { tag: highlight.tags.propertyName, color: "var(--color-accent-text)" },
          { tag: highlight.tags.string, color: "var(--color-success)" },
          { tag: highlight.tags.number, color: "var(--color-warning)" },
          { tag: [highlight.tags.bool, highlight.tags.null], color: "var(--color-danger)" },
        ]);
        const theme = cmView.EditorView.theme({
          "&": { fontSize: "12px", backgroundColor: "var(--color-surface-sunken)", color: "var(--color-text)", height: `${height}px`, borderRadius: "var(--radius-md)" },
          ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" },
          ".cm-gutters": { backgroundColor: "var(--color-surface-sunken)", color: "var(--color-text-subtle)", border: "none" },
          ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-selection)" },
          "&.cm-focused": { outline: "2px solid var(--color-focus)", outlineOffset: "2px" },
          ".cm-foldPlaceholder": { backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" },
        });
        const v = new cmView.EditorView({
          state: state.EditorState.create({
            doc: text,
            extensions: [
              cmView.lineNumbers(),
              cmView.highlightActiveLine(),
              language.foldGutter(),
              language.bracketMatching(),
              language.syntaxHighlighting(style),
              json.json(),
              cmView.keymap.of([...commands.defaultKeymap, ...language.foldKeymap]),
              state.EditorState.readOnly.of(true),
              cmView.EditorView.editable.of(false),
              cmView.EditorView.contentAttributes.of({ "aria-label": ariaLabel, role: "textbox", "aria-readonly": "true" }),
              theme,
            ],
          }),
          parent: host.current,
        });
        view = v;
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
      view?.destroy();
    };
  }, [text, height, ariaLabel]);

  return (
    <div className={cn("relative", className)}>
      <div ref={host} className={cn(!ready && "hidden")} />
      {!ready && (
        <pre aria-label={ariaLabel} className="overflow-auto rounded-md bg-surface-sunken p-3 font-mono text-xs" style={{ height }}>
          {text}
        </pre>
      )}
    </div>
  );
}
