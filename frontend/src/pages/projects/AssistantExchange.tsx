import Markdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { AssistantContextCard } from "./AssistantContextCard";
import { assistantStatusText, isActive, type AssistantState } from "./assistantState";

// Only presentation elements: model output cannot create links, images or HTML.
// Raw HTML stays escaped; do not add rehype-raw or dangerouslySetInnerHTML.
const MARKDOWN_ELEMENTS = [
  "p", "strong", "em", "code", "pre", "ul", "ol", "li", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr",
];

// The same rendering is used for the active answer and earlier local exchanges.
export function AssistantExchange({ question, answer, onReuse, reuseDisabled }: {
  question: string;
  answer: AssistantState;
  onReuse: (question: string) => void;
  reuseDisabled: boolean;
}) {
  const failed = answer.status === "interrupted" || answer.status === "failed";
  return (
    <article aria-label="Assistant exchange" className="space-y-3">
      {question && (
        <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          {question}
        </div>
      )}
      {answer.context && <AssistantContextCard context={answer.context} />}
      {answer.text && (
        <div data-testid="assistant-answer" className="space-y-2 break-words text-sm text-foreground [overflow-wrap:anywhere] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_pre]:whitespace-pre-wrap [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold">
          <Markdown allowedElements={MARKDOWN_ELEMENTS} unwrapDisallowed>
            {answer.text}
          </Markdown>
        </div>
      )}
      {failed && answer.failure ? (
        <div className="rounded-md bg-red-50 p-2 text-xs text-red-800">
          <p className="break-words">{answer.failure.message}</p>
          {answer.failure.requestId && (
            <p className="mt-1 break-all text-red-600">Request ID: {answer.failure.requestId}</p>
          )}
        </div>
      ) : (
        <p className={answer.status === "truncated"
          ? "text-xs font-medium text-amber-700"
          : "text-xs text-muted-foreground"}>
          {assistantStatusText(answer)}
        </p>
      )}
      {question && !isActive(answer.status) && answer.status !== "ready" && (
        <Button type="button" size="xs" variant="outline" disabled={reuseDisabled}
          onClick={() => onReuse(question)}>
          Reuse question
        </Button>
      )}
    </article>
  );
}
