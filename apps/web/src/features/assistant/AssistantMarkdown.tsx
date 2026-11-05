import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AssistantChart, parseChartSpec } from "./AssistantChart";
import { FileLink, parseFileRef } from "./FileLink";

/**
 * The assistant's replies, rendered as markdown.
 *
 * It writes lists and emphasis whether or not anything renders them —
 * "what's missing on this claim" is a list, and as plain text it
 * arrived as a wall of asterisks. So this parses properly rather than
 * regexing a few cases: model output contains tables, nested lists and
 * code fences sooner or later, and a half-parser mangles them more
 * visibly than no parser at all.
 *
 * Raw HTML is not enabled, which is the default and stays that way.
 * This is model output rendered into a page that holds patient data —
 * there is no version of letting it emit markup that is worth the
 * convenience.
 *
 * Every element is styled explicitly rather than inherited: the drawer
 * is a column, not a page, and prose defaults built for an article leave headings
 * and code blocks that overflow it.
 */
/**
 * Digs the source out of a ```chart block.
 *
 * react-markdown hands `pre` a `code` element whose className carries
 * the language, so this is the only place both the fence language and
 * its contents are visible at once.
 */
function chartSpecFrom(children: React.ReactNode) {
  const code = Array.isArray(children) ? children[0] : children;
  if (!isElementWithProps(code)) return null;
  const className = String(code.props.className ?? "");
  if (!className.includes("language-chart")) return null;
  const source = Array.isArray(code.props.children)
    ? code.props.children.join("")
    : String(code.props.children ?? "");
  return parseChartSpec(source);
}

function isElementWithProps(
  node: unknown,
): node is { props: { className?: unknown; children?: unknown } } {
  return (
    typeof node === "object" &&
    node !== null &&
    "props" in node &&
    typeof (node as { props: unknown }).props === "object"
  );
}

export function AssistantMarkdown({ children }: { children: string }) {
  return (
    <div className="text-base leading-relaxed text-ink [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // The default transform drops any scheme it doesn't recognise,
        // which would silently turn every file link into a dead one.
        // Everything else still goes through it, so http(s) and mailto
        // are sanitised exactly as before.
        urlTransform={(url) =>
          parseFileRef(url) ? url : defaultUrlTransform(url)
        }
        components={{
          p: ({ children }) => <p className="m-0 mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="m-0 mb-2 list-disc pl-[18px] last:mb-0 [&_li]:mt-0.5">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="m-0 mb-2 list-decimal pl-[18px] last:mb-0 [&_li]:mt-0.5">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-ink">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className="rounded-xs bg-hover px-1 py-px font-mono text-sm">
              {children}
            </code>
          ),
          // A ```chart block becomes a chart; anything else stays a
          // code block. A malformed spec falls through to one too,
          // which is the honest failure — the text is still readable.
          pre: ({ children }) => {
            const spec = chartSpecFrom(children);
            if (spec) return <AssistantChart spec={spec} />;
            return (
              <pre className="m-0 mb-2 overflow-x-auto rounded-sm border border-line bg-surface-raised p-2 text-sm last:mb-0">
                {children}
              </pre>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="m-0 mb-2 border-l-2 border-line-strong pl-2 text-ink-faint last:mb-0">
              {children}
            </blockquote>
          ),
          // Headings exist in the parse tree whether or not the prompt
          // asks for them. Rendered small rather than as display type:
          // a 24px heading in a chat bubble reads as a mistake.
          h1: ({ children }) => (
            <div className="mb-1 mt-2 font-semibold first:mt-0">{children}</div>
          ),
          h2: ({ children }) => (
            <div className="mb-1 mt-2 font-semibold first:mt-0">{children}</div>
          ),
          h3: ({ children }) => (
            <div className="mb-1 mt-2 font-semibold first:mt-0">{children}</div>
          ),
          hr: () => <hr className="my-2.5 border-0 border-t border-line" />,
          // The drawer is narrow and a table is the one thing that
          // cannot be made to fit; it scrolls inside itself rather than
          // pushing the panel sideways.
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-line px-1.5 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-line px-1.5 py-1 align-top">
              {children}
            </td>
          ),
          a: ({ href, children }) => {
            // A document or attachment the model named: resolved to a
            // signed URL on click rather than up front.
            const reference = parseFileRef(href);
            if (reference) {
              return <FileLink reference={reference}>{children}</FileLink>;
            }
            // Anything else is outside this app, so it opens away from
            // the desk's session and carries noopener.
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-ink underline"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
