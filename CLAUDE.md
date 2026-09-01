# ToolGraph

ToolGraph is a new project currently being initialized.

## Development state

The application framework, backend, database, authentication system, hosting platform, and final architecture have not yet been selected.

Claude must inspect the repository before assuming any technology.

## AI design tools

For UI/frontend work, Claude has access to:

- **Impeccable** — installed and configured for Claude Code.
- **Taste Skill** — specifically `design-taste-frontend`, installed for Claude Code in this project.
- **Awesome DESIGN.md reference library** — located at:
  - `~/.agent-resources/awesome-design-md`
  - `design-md/` contains ready-to-use DESIGN.md references analyzed from real products.

Claude should use Impeccable and Taste Skill when relevant for frontend/UI tasks.

The Awesome DESIGN.md library should only be used when I explicitly request a specific reference or when a design direction is appropriate and approved.

If a specific DESIGN.md reference is explicitly selected, use that reference as an additional design-language input.

Never blindly merge several conflicting design systems. Never clone another company's website. ToolGraph must develop its own visual identity.

## Coding rules

- Prefer TypeScript when the application stack is selected
- Use strict typing
- Avoid unnecessary `any`
- Avoid unnecessary dependencies
- Reuse components rather than duplicating them
- Keep accessibility in mind
- Maintain responsive design
- Fix root causes instead of suppressing errors
- Do not expose secrets
- Never commit environment variable values
- Inspect existing code before broad changes
- Do not rewrite unrelated user work

## Git rules

- Check git status before broad changes
- Never force-push
- Never commit secrets
- Do not commit or push unless specifically instructed

## Environment variables

If `.env` files are added later:

- Never reveal secret values
- Never hard-code secrets into source code, CLAUDE.md, documentation, or prompts
- Never commit env values
- Preserve existing environment-variable names unless changing them is intentional
