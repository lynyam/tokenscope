import { buttonVariants } from "../components/ui/button";
import { ProductPreview } from "../components/ProductPreview";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { LegalLinks } from "../components/LegalLinks";
import {
  LandingActions,
  LandingHeader,
  sectionLinkClasses,
} from "../components/LandingHeader";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../components/ui/card";

const productBenefits = [
  {
    title: "Understand your spending",
    description:
      "See how estimated costs are distributed across projects, models, and workflows.",
  },
  {
    title: "Investigate expensive requests",
    description:
      "Examine token usage, response times, and request status to understand which requests deserve attention.",
  },
  {
    title: "Make decisions together",
    description:
      "Give your team a shared view of the evidence behind its AI spending.",
  },
];

const audiences = [
  {
    title: "SaaS teams and technical founders",
    description:
      "Understand the cost of AI features such as customer support and document summarisation.",
  },
  {
    title: "Engineering teams",
    description:
      "Investigate usage across chatbots, document-processing workflows, assistants, and agents.",
  },
  {
    title: "AI agencies",
    description:
      "Organise visibility across the AI projects you manage for different clients.",
  },
];

function InfoCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3>{title}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>{description}</CardDescription>
      </CardContent>
    </Card>
  );
}

export function LandingPage() {
  const { user } = useCurrentUser();
  const isLoggedIn = Boolean(user);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <LandingHeader isLoggedIn={isLoggedIn} />

      <main className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <p className="mb-6 text-sm text-muted-foreground">
          For teams building AI products
        </p>

        <h1 className="max-w-4xl font-heading text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          Understand your LLM costs.
          <br />
          Know what to investigate next.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          TokenScope is being built to bring AI usage, estimated costs,
          and request details into one shared workspace—so your team
          can understand where its spending comes from.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <LandingActions
            isLoggedIn={isLoggedIn}
            size="lg"
            showLogin={false}
          />

          <a
            href="#how-it-works"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            See how it works
          </a>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          Usage reporting and cost analytics are coming soon.
        </p>

        <section
          id="product"
          aria-labelledby="product-heading"
          className="mt-24 border-t border-border pt-16"
        >
          <h2
            id="product-heading"
            className="font-heading text-3xl font-semibold sm:text-4xl"
          >
            See what is driving your spend.
          </h2>

          <p className="mt-4 max-w-2xl text-muted-foreground">
            Upcoming capabilities designed to help your team understand and
            investigate its AI costs.
          </p>

          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {productBenefits.map((benefit) => (
              <InfoCard
                key={benefit.title}
                title={benefit.title}
                description={benefit.description}
              />
            ))}
          </div>

          <ProductPreview />
        </section>

        <section
          id="audience"
          aria-labelledby="audience-heading"
          className="mt-24 border-t border-border pt-16"
        >
          <h2
            id="audience-heading"
            className="font-heading text-3xl font-semibold sm:text-4xl"
          >
            Built for teams shipping AI features.
          </h2>

          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {audiences.map((audience) => (
              <InfoCard
                key={audience.title}
                title={audience.title}
                description={audience.description}
              />
            ))}
          </div>
        </section>

        <section
          id="how-it-works"
          aria-labelledby="how-it-works-heading"
          className="mt-24 border-t border-border pt-16"
        >
          <h2
            id="how-it-works-heading"
            className="font-heading text-3xl font-semibold sm:text-4xl"
          >
            From usage events to clearer decisions.
          </h2>

          <p className="mt-4 max-w-2xl text-muted-foreground">
            The intended TokenScope journey, with upcoming steps marked below.
          </p>

          <ol className="mt-10 grid list-none gap-8 md:grid-cols-3">
            <li>
              <span className="text-sm text-muted-foreground">01</span>
              <h3 className="mt-3 text-lg font-semibold">
                Create your workspace
              </h3>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                Start with an account, an organization for your team,
                and a project for your AI application.
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Create your account, organize your team, and manage your projects.
              </p>
            </li>

            <li>
              <span className="text-sm text-muted-foreground">
                02 · Upcoming
              </span>
              <h3 className="mt-3 text-lg font-semibold">
                Send usage events
              </h3>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                Connect your application’s usage reporting to your project
                using a TokenScope API key.
              </p>
            </li>

            <li>
              <span className="text-sm text-muted-foreground">
                03 · Upcoming
              </span>
              <h3 className="mt-3 text-lg font-semibold">
                Explore and investigate
              </h3>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                Review estimated costs, compare workflows and models,
                and inspect individual AI requests.
              </p>
            </li>
          </ol>
        </section>

        <section
          aria-labelledby="closing-heading"
          className="mt-24 border-t border-border pt-16"
        >
          <h2
            id="closing-heading"
            className="font-heading text-3xl font-semibold sm:text-4xl"
          >
            Bring your LLM costs into focus.
          </h2>

          <p className="mt-4 max-w-2xl text-muted-foreground">
            Start exploring TokenScope as the product takes shape.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <LandingActions isLoggedIn={isLoggedIn} size="lg" />
          </div>
        </section>

        <footer className="mt-24 border-t border-border py-10">
          <div className="flex flex-col gap-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>TokenScope — collaborative LLM cost observability.</p>

            <nav
              aria-label="Footer navigation"
              className="flex flex-wrap gap-4"
            >
              <a href="#product" className={sectionLinkClasses}>
                Product
              </a>
              <a href="#audience" className={sectionLinkClasses}>
                Who it’s for
              </a>
              <a href="#how-it-works" className={sectionLinkClasses}>
                How it works
              </a>
            </nav>
          </div>

          <LegalLinks className="mt-6 justify-start" />
        </footer>
      </main>
    </div>
  );
}