# Repository and Git Workflow

## Repository structure

This is a basic explanation:

- `frontend/` : React application
- `backend/`: NestJS application
- `docs/`: architecture, onboarding, ADRs
- `compose.yaml`: local multi-container environment
- `Makefile`: common project commands
- `.env.example`: required environment variables without secrets

## Branch strategy

- `main`: stable branch; always runnable; protected; never push directly on main.
- `develop`: shared integration branch; protected; ask PR to be reviewing before merge on it.
- `feature/tse-<issue-id>-short-description`: one Linear issue or sub-issue; Follow exactelly the pattern on linear name, and link to the linear issue to easly follow.
- `fix/tse-<issue-id>-short-description`: bug fix; same rule for feature pattern.

## Development workflow

1. Start from `develop`
2. Pull the latest changes.
3. Create a feature/issue branch (The name can be copy directly on linear by open the issue/sub-issue and click `copy git branch name` in top right branch icon. shorted desciption if too long).
4. Implement one Linear issue.
5. Commit small, meaningful changes.
6. Push the branch.
7. Open a Pull Request to `develop`.
8. Request one review.
9. Merge only after approval and successful tests.
10. Delete the feature branch after merge.

    ### example:
    git clone git@github.com:lynyam/tokenscope.git tokenscope
    git switch develop (1)
    git pull origin develop (2)
    git swith -c feature/tse-13-repository-structure-and-branch-strategy

## Commit message convention

Use:

`type(scope): short imperative description`

Examples:

`commit -m "docs(workflow): define repository structure and branch strategy"`

- `feat(auth): add sign-up form validation`
- `fix(api): reject duplicate email`
- `docs(workflow): define PR rules`
- `test(health): add endpoint integration test`
- `chore(docker): add PostgreSQL service`

*Allowed types:* `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `style`.

Commit messages must be clear, lowercase, written in the imperative form,
and represent one logical change.

## Pull Request rules

Every PR must contain:
- Linked Linear issue.
- Clear description.
- How it was tested.
- Screenshots for visible UI changes.
- No secrets, `.env`, build artifacts, or `node_modules`.

## Our branch strategy looks like this:

    main
     ↑
    develop
     ↑
    feature/tse-13-health-endpoint
    feature/tse-14-react-shell
    fix/tse-21-health-error-state

## Meaning
    feature branch -> Pull Request -> develop
    develop -> Pull Request -> main

    NB: We use `main` only for stable milestone release
