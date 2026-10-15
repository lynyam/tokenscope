import { Link } from "react-router-dom";
import { LegalLayout } from "../../layouts/LegalLayout";
import { useScrollToTop } from "../../hooks/useScrollToTop";

const CONTACT_EMAIL = "contact@example.com";

export function TermsPage() {
  useScrollToTop();

  return (
    <LegalLayout title="Terms of Service">
      <section>
        <h2>About TokenScope</h2>
        <p>
          TokenScope is an educational and evaluation application for observing
          LLM usage and estimated costs. It provides organization and project
          workspaces, trace ingestion and management, analytics, real-time
          updates, exports, document storage and an assistant for explaining
          selected trace measurements.
        </p>
        <p>
          The application is under active development. These terms describe the
          conditions and limitations of using the evaluation version.
        </p>
      </section>

      <section>
        <h2>Accounts and access</h2>
        <p>
          Use an account and workspace that you are authorized to access. Keep
          your password, access token and project API keys confidential.
        </p>
        <p>
          Organization owners manage membership. Available actions depend on your
          current role and the state of the organization and project. Changes to
          membership, project status or key validity can remove access.
        </p>
        <p>
          A project API key permits trace operations within its assigned project.
          Share it only with applications and people who are authorized to perform
          those operations. Revoke a key if it is exposed or no longer needed.
        </p>
      </section>

      <section>
        <h2>Information you submit</h2>
        <p>
          Submit only information and files that you have permission to use and
          share with the relevant workspace members.
        </p>
        <p>
          Use synthetic or disposable information for evaluation. Avoid uploading
          confidential customer records, credentials or unnecessary personal
          information.
        </p>
        <p>
          You retain any rights you hold in the content you submit. Submitting
          content allows the application to process it for the functions described
          in the <Link to="/privacy">Privacy Policy</Link>, including storage,
          authorized workspace access, analytics and document preview.
        </p>
        <p>
          Do not assume that project documents are visible only to the person who
          uploaded them. Authorized organization members can access them.
        </p>
      </section>

      <section>
        <h2>Cost estimates and exports</h2>
        <p>
          TokenScope calculates estimated costs from submitted token counts and
          the pricing records applied to each trace.
        </p>
        <p>
          An estimate can differ from a provider’s invoice because of differences
          in recorded usage, pricing, discounts, billing rules or other charges.
          Use the provider’s billing records to establish actual charges.
        </p>
        <p>
          Evaluation fixtures can use synthetic providers, models, prices and
          usage. These examples must be identified as synthetic.
        </p>
        <p>
          Dashboard exports represent the selected analytics data and filters.
          They do not necessarily contain every individual trace.
        </p>
        <p>
          TokenScope does not guarantee a particular level of savings or the
          accuracy of information supplied by an external application.
        </p>
      </section>

      <section>
        <h2>Assistant output</h2>
        <p>
          The assistant uses an external LLM provider to generate explanations
          from your question and selected trace measurements.
        </p>
        <p>
          Generated answers can be incomplete or incorrect. Check calculations
          and factual statements before relying on them.
        </p>
        <p>
          The assistant has limited context. It does not automatically inspect
          uploaded documents or the original prompts and responses from the
          application that produced a trace. It cannot establish a cause or a
          realized saving from information that has not been supplied.
        </p>
        <p>
          The assistant does not automatically change project data or execute
          actions on your behalf. Its availability depends on the operator’s
          configuration, provider availability and request limits.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not attempt to bypass authentication, access another organization’s
          information, misuse credentials, overwhelm the service or submit
          malicious files.
        </p>
        <p>
          Respect access restrictions and request limits. Coordinate security
          testing that could affect other users or shared infrastructure with
          the project operator.
        </p>
        <p>
          Use the application only for activities and content you are authorized
          to process.
        </p>
      </section>

      <section>
        <h2>Availability and changes</h2>
        <p>
          The evaluation service can be interrupted, changed or withdrawn as
          development continues. Features can be unavailable because of
          configuration, maintenance, failures or external provider limits.
        </p>
        <p>
          No contractual uptime, backup or recovery commitment is provided for
          this evaluation version. Keep separate copies of information you need
          to retain.
        </p>
      </section>

      <section>
        <h2>Deletion and ending use</h2>
        <p>
          You can stop using the application and sign out at any time. Signing
          out does not delete stored information.
        </p>
        <p>
          Organization deletion, document deletion, trace deletion, project
          archiving and key revocation have different effects. Review the{" "}
          <Link to="/privacy">Privacy Policy</Link> before using those controls.
        </p>
        <p>
          Organization deletion is irreversible through the application and
          affects the organization’s shared data. It preserves global user
          accounts and other organizations.
        </p>
        <p>
          The evaluation version does not include self-service account deletion.
          Personal-data requests should use the operator’s verified private
          contact.
        </p>
      </section>

      <section>
        <h2>Contact and updates</h2>
        <p>
          For questions about these terms or private requests, write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
        <p>
          Use{" "}
          <a href="https://github.com/lynyam/tokenscope/issues">
            TokenScope’s GitHub issues
          </a>{" "}
          for general project questions and bug reports. Do not include
          passwords, keys or private account and workspace information.
        </p>
        <p>
          These terms can be updated as the application changes. The date at the
          top identifies the latest revision.
        </p>
        <p>
          Nothing in these terms excludes rights that cannot lawfully be
          excluded.
        </p>
      </section>
    </LegalLayout>
  );
}