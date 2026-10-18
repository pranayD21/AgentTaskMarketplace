import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";

/**
 * Assistant text as Markdown (GFM) with inline and display LaTeX.
 * Math renders as MathML, so no KaTeX fonts or stylesheet are needed (the daemon's CSP
 * allows no web fonts). Raw HTML in the source is never rendered; links open in a new tab.
 */
function mathSource(text: string): string {
  // Older structured answers were JSON-parsed after the model wrote single TeX backslashes.
  // JSON interpreted \f and \t as controls, so restore only recognizable math commands.
  const restored = text.replace(/\f(?=rac\b)/g, "\\f").replace(/\t(?=ext\b|imes\b|heta\b)/g, "\\t")
    .replace(/\u0008(?=egin\b|eta\b)/g, "\\b").replace(/\r(?=ight\b|ho\b)/g, "\\r").replace(/\n(?=abla\b)/g, "\\n");
  // remark-math accepts $ and $$; models also use \(...\) and \[...\].
  // Leave fenced and inline code untouched.
  return restored.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g).map((part) =>
    part.startsWith("```") || part.startsWith("~~~") || part.startsWith("`") ? part
      : part.replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `\n\n$$\n${body}\n$$\n\n`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body}$`)).join("");
}
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { output: "mathml", throwOnError: false }]]} skipHtml
        components={{ a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
        {mathSource(text)}
      </ReactMarkdown>
    </div>
  );
}
