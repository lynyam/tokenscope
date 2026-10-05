import { LegalLayout } from "../../layouts/LegalLayout";

const deletionActions = [
  {
    action: "Sign out",
    effect:
      "Removes the local browser session. Stored account and workspace data remain.",
  },
  {
    action: "Remove a member",
    effect:
      "Removes their organization membership. Their global account remains.",
  },
  {
    action: "Archive a project",
    effect:
      "Retains the project and its records while disabling access through the active-project features.",
  },
  {
    action: "Revoke an API key",
    effect:
      "Disables subsequent use of the key. Its management record remains.",
  },
  {
    action: "Delete a trace",
    effect:
      "Hides it from normal reads and analytics. The stored trace record, including its submitted data, remains marked as deleted and reserves its external identifier.",
  },
  {
    action: "Delete a document",
    effect:
      "Removes its application record and access immediately. Physical file removal runs in the background and is retried if necessary.",
  },
  {
    action: "Delete an organization",
    effect:
      "Removes that organization’s memberships, projects, keys, traces and document records, and schedules removal of its document files. Global accounts and other organizations remain.",
  },
];

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <section>
        <h2>About this policy</h2>
        <p>
          TokenScope is an educational and evaluation project for observing LLM
          usage and estimated costs. It provides shared organizations and
          projects, trace ingestion, analytics, document storage and an assistant
          that explains selected trace measurements.
        </p>
        <p>
          This policy explains the information handled by the evaluation
          application, who can access it and the effects of its data-management
          controls.
        </p>
      </section>

      <section>
        <h2>Account and workspace information</h2>
        <p>
          When you register, TokenScope receives your display name, email address
          and password. These fields are required to create an account. The
          application stores your account identifier, display name, email
          address, creation and update dates, and a hash of your password.
        </p>
        <p>
          TokenScope also stores organization and project information, membership
          relationships and roles. This information supports shared workspaces
          and determines which actions each member can perform.
        </p>
        <p>
          Organization members can see other members’ display names, email
          addresses and roles. Organization owners manage membership and can add
          an existing user using their email address.
        </p>
      </section>

      <section>
        <h2>Project keys and trace information</h2>
        <p>
          Project API keys allow applications to send and manage traces for a
          specific project. TokenScope stores a hash of each key, a visible
          prefix, its name, its creator and relevant creation, use and revocation
          dates. The complete key is shown when it is created and is not
          available for later retrieval.
        </p>
        <p>
          A trace contains information supplied by the sending application,
          including an external identifier, provider and model names, workflow,
          input and output token counts, latency, status, occurrence time and
          optional metadata. TokenScope also stores calculated cost estimates,
          the pricing information used and record-management information.
        </p>
        <p>
          These records support trace browsing, search, cost calculation and
          analytics. Free-text fields and optional metadata can contain personal
          or confidential information if you include it. Use synthetic data for
          evaluation and avoid submitting unnecessary personal information,
          credentials or confidential customer content.
        </p>
        <p>
          Recording a trace whose provider field names a company does not itself
          send that trace to the company. The explicit assistant request is the
          external LLM data flow.
        </p>
      </section>

      <section>
        <h2>Documents</h2>
        <p>
          Authorized users can upload PDF, text and Markdown documents to a
          project. TokenScope stores the file contents and information needed to
          manage them, including the filename, format, size, upload date,
          uploader and file-integrity information.
        </p>
        <p>
          Documents are shared with authorized members of the organization that
          owns the project. They are accessed through authenticated application
          requests and are not published as unrestricted file links.
        </p>
        <p>
          The evaluation assistant does not automatically receive or analyze
          uploaded documents. Uploading a file does not send it to OpenAI.
        </p>
      </section>

      <section>
        <h2>Assistant requests and OpenAI</h2>
        <p>
          When you submit a question in the trace assistant, TokenScope sends
          your question to OpenAI together with selected facts from the
          authorized trace: provider and model names, token counts, pricing and
          cost breakdown, status and latency.
        </p>
        <p>
          The question is sent as you enter it. Do not include passwords, API
          keys or confidential information that should not be sent to the
          provider.
        </p>
        <p>
          TokenScope does not automatically add uploaded documents, arbitrary
          trace metadata, account email addresses or API credentials to the
          assistant’s prompt.
        </p>
        <p>
          Questions and answers are held in the current browser view and are
          cleared when that view is left or reset. TokenScope does not save them
          as persistent chat history in its application database.
        </p>
        <p>
          OpenAI processes the request under its API policies and the operator’s
          account settings. Disabling saved response history does not guarantee
          that all provider-side retention is disabled. See{" "}
          <a href="https://developers.openai.com/api/docs/guides/your-data">
            OpenAI’s API data controls
          </a>
          .
        </p>
        <p>
          Stopping a response cancels further processing where possible. It
          cannot recall information already transmitted to the provider or
          already displayed in the browser.
        </p>
      </section>

      <section>
        <h2>Browser storage and live updates</h2>
        <p>
          TokenScope stores an access token in your browser’s local storage so
          that the session can be restored after a page reload. Signing out
          removes the application’s local session. Clearing the site’s browser
          storage also removes that stored token.
        </p>
        <p>
          Signing out does not delete your account or workspace data. An
          independently copied access token can remain usable until it expires,
          subject to the application’s access checks.
        </p>
        <p>
          Live project updates use an authenticated connection to TokenScope.
          Change notifications tell the browser to fetch updated project
          information. They do not automatically send project data to the
          assistant provider.
        </p>
      </section>

      <section>
        <h2>Operational information</h2>
        <p>
          The application records operational information to diagnose failures
          and operate the service. Application request logs include information
          such as a request identifier, request method and route, response
          status, duration and permitted resource identifiers.
        </p>
        <p>
          The application’s request logger excludes passwords, access tokens,
          API-key values and request-body contents. Infrastructure and provider
          logging are separate and depend on the deployment configuration.
        </p>
        <p>
          Rate limiting uses temporary counters associated with requests, users,
          project keys or network addresses to control excessive traffic.
        </p>
      </section>

      <section>
        <h2>Who can access information</h2>
        <p>
          Access to workspace information depends on current organization
          membership and role. Authorized members can read the project
          information exposed by the application. Certain actions, including
          document management and API-key management, require an OWNER or ADMIN
          role.
        </p>
        <p>
          Someone holding a valid project API key can perform the trace
          operations authorized by that key. Protect keys as credentials.
        </p>
        <p>
          People administering the application’s database, file storage or
          hosting environment can have technical access to stored information.
          OpenAI receives the information described in the assistant section
          when a user submits an assistant question.
        </p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <p>
          Application records and uploaded files persist across ordinary
          application stops and restarts. The evaluation application does not
          automatically expire these records after a fixed age.
        </p>
        <p>The available controls have the following effects:</p>

        <dl className="my-6 divide-y divide-border border-y border-border">
          {deletionActions.map(({ action, effect }) => (
            <div
              key={action}
              className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6"
            >
              <dt className="font-semibold">{action}</dt>
              <dd className="min-w-0">{effect}</dd>
            </div>
          ))}
        </dl>

        <p>
          This evaluation version does not provide a self-service
          account-deletion control.
        </p>
        <p>
          Deleting a resource does not remove copies already downloaded or
          exported by users. It also does not automatically delete information
          already processed by an external provider. Log and backup retention
          must be considered separately from deletion in the active application.
        </p>
      </section>

      <section id="your-information-and-requests">
        <h2>Your information and requests</h2>
        <p>
          You can ask the operator of your TokenScope instance about access to,
          correction of or deletion of your personal information.
        </p>
        <p>
          Depending on the applicable law and circumstances, you may also have
          rights concerning restriction, objection, portability and complaints
          to a supervisory authority.
        </p>
        <p>
          Personal-data requests should use the operator’s verified private
          contact. Do not post account information, identity documents,
          credentials or private workspace content in a public issue.
        </p>
      </section>

      <section>
        <h2>Project contact and policy updates</h2>
        <p>
          General project questions and bug reports can be submitted through{" "}
          <a href="https://github.com/lynyam/tokenscope/issues">
            TokenScope’s GitHub issues
          </a>
          . This is a public project contact channel.
        </p>
        <p>
          Following an external link takes you to a service with its own privacy
          practices.
        </p>
        <p>
          This policy is updated when the application’s data handling changes.
          The date at the top identifies the latest content review.
        </p>
      </section>
    </LegalLayout>
  );
}