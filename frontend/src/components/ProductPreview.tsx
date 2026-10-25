import { useState } from "react";

const screenshots = [
  {
    src: "/screenshots/3.webp",
    label: "Analytics overview",
    width: 1024,
    height: 702,
    alt: "TokenScope analytics with period filters, estimated cost, traces, token counts, average latency, and error rate.",
  },
  {
    src: "/screenshots/2.webp",
    label: "Costs and tokens",
    width: 1021,
    height: 389,
    alt: "TokenScope charts comparing estimated costs and input and output tokens by provider and model.",
  },
  {
    src: "/screenshots/1.webp",
    label: "AI assistant",
    width: 1024,
    height: 895,
    alt: "TokenScope AI assistant answering a question about median estimated daily cost alongside analytics charts.",
  },
  {
    src: "/screenshots/4.webp",
    label: "Light-theme preview",
    width: 1023,
    height: 561,
    alt: "TokenScope analytics filters and summary metrics displayed in light mode.",
  },
];

export function ProductPreview() {
  const [selected, setSelected] = useState(0);
  const screenshot = screenshots[selected];

  return (
    <figure
      aria-labelledby="preview-caption"
      className="mt-12 overflow-hidden rounded-xl border border-border bg-card"
    >
      <figcaption
        id="preview-caption"
        className="border-b border-border px-6 py-4"
      >
        <p className="font-semibold">A closer look at your AI spending</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Static screenshots from tokenscope · Demo data · Estimated costs
        </p>
      </figcaption>

      <div
        role="group"
        aria-label="Choose a product screenshot"
        className="flex flex-wrap gap-2 border-b border-border p-4"
      >
        {screenshots.map((item, index) => (
          <button
            key={item.src}
            type="button"
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              selected === index
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="p-2 sm:p-4">
        <a
          href={screenshot.src}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={`Open ${screenshot.label} screenshot in a new tab`}
        >
          <img
            src={screenshot.src}
            alt={screenshot.alt}
            width={screenshot.width}
            height={screenshot.height}
            loading="lazy"
            decoding="async"
            className="mx-auto block h-auto w-full max-w-5xl rounded-lg border border-border"
          />
        </a>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Select a screenshot above; this does not change the site theme.
          Use the header theme button to change the site theme.
          Open the screenshot to view it full size in a new tab.
        </p>
      </div>
    </figure>
  );
}
