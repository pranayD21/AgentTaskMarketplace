import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Assistant text as Markdown (GFM). Raw HTML in the source is never rendered; links open in a new tab. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
        components={{ a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
