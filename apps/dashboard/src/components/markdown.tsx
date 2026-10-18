import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";

/**
 * Assistant text as Markdown (GFM) with simple LaTeX: `$x^2$` inline and `$$...$$` blocks.
 * Math renders as MathML, so no KaTeX fonts or stylesheet are needed (the daemon's CSP
 * allows no web fonts). Raw HTML in the source is never rendered; links open in a new tab.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { output: "mathml", throwOnError: false }]]} skipHtml
        components={{ a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
