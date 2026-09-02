# End-to-end tests

## The selector contract

These tests address elements by `data-testid`, never by visible text or CSS
class. That keeps them stable when copy or styling changes. The web app is
expected to expose exactly these ids:

| `data-testid`                                 | Where                 | What it is                          |
| --------------------------------------------- | --------------------- | ----------------------------------- |
| `signup-email`                                | `/signup`             | Email input                         |
| `signup-password`                             | `/signup`             | Password input                      |
| `signup-submit`                               | `/signup`             | Submit button                       |
| `login-email`                                 | `/login`              | Email input                         |
| `login-password`                              | `/login`              | Password input                      |
| `login-submit`                                | `/login`              | Submit button                       |
| `auth-error`                                  | `/login`, `/signup`   | Inline error message container      |
| `user-menu`                                   | app shell             | Signed-in user menu trigger         |
| `sign-out`                                    | app shell             | Sign out control                    |
| `new-graph-button`                            | `/graphs`             | Creates a graph and navigates to it |
| `graph-list`                                  | `/graphs`             | Container for the saved graph cards |
| `graph-card`                                  | `/graphs`             | One saved graph (repeated)          |
| `graph-title-input`                           | `/graphs/[id]`        | Editable graph title                |
| `canvas`                                      | `/graphs/[id]`        | The reactflow canvas root           |
| `add-server-button`                           | `/graphs/[id]`        | Opens the connect-MCP-server dialog |
| `theme-toggle`                                | app shell             | Light/dark/system toggle            |
| `mobile-nav-toggle`                           | headers, below `sm`   | Hamburger trigger                   |
| `mobile-nav-panel`                            | headers, below `sm`   | The open dropdown                   |
| `sign-out-mobile`                             | app shell, below `sm` | Sign out inside the mobile menu     |
| `export-button`                               | `/graphs/[id]`        | Opens the export panel              |
| `export-tab-typescript` / `export-tab-python` | export panel          | Target switch                       |
| `export-download`                             | export panel          | Download control                    |

If you rename one of these, update this table in the same commit.

## Running

```bash
# against a local dev stack (starts both apps itself)
pnpm test:e2e

# against a deployment
E2E_BASE_URL=https://toolgraph.dev pnpm test:e2e
```

The local run needs a Supabase stack to sign up against:

```bash
supabase start
```

CI does exactly this, using the CLI's fixed local development keys — no live
secret is ever present in a CI run.
