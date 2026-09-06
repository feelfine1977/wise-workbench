import { cn } from "@/lib/utils";

/** The reading sentence (UX-4): descriptive vocabulary only. */
export function ReadingSentence({ text, className, as: Tag = "p" }: { text: string | undefined; className?: string; as?: "p" | "h1" | "h2" | "span" }) {
  if (!text) return null;
  return <Tag className={cn("text-md leading-6 text-text [&_em]:not-italic [&_em]:font-semibold", className)} dangerouslySetInnerHTML={{ __html: emphasise(text) }} />;
}

/** Wraps *phrases* in <em>, escaping everything else. */
export function emphasise(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
  return escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
