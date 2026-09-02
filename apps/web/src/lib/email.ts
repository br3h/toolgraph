import 'server-only';

/**
 * Transactional email through Resend.
 *
 * Supabase's built-in sending is rate-limited to a handful of messages an hour
 * on the free tier, which is not enough for even light real use, so welcome and
 * confirmation mail goes through Resend instead.
 *
 * Every function here is a no-op when Resend is not configured. Sending mail
 * must never be the reason a signup fails — the account is already created by
 * the time we get here.
 */

import { Resend } from 'resend';

import { hasResend, serverEnv } from './env';

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!hasResend()) return null;
  client ??= new Resend(serverEnv.resendApiKey);
  return client;
}

export interface SendResult {
  sent: boolean;
  skipped?: 'not_configured';
  error?: string;
}

/**
 * Escapes the five characters that matter in HTML text and attribute contexts.
 *
 * Every other string interpolated into the templates below is either a constant
 * or a URL this application built. A workspace name is not: it is chosen by one
 * user and rendered in another user's mail client.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The monochrome constraint applies to email too. Inline styles only, since
 * mail clients strip stylesheets, and no hue anywhere.
 */
function wrap(title: string, bodyHtml: string, siteUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#ffffff;color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid #e9e9e9;border-radius:10px;padding:32px;">
            <tr>
              <td>
                <p style="margin:0 0 24px;font-size:15px;font-weight:700;letter-spacing:-0.01em;">Toolgraph</p>
                <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;line-height:1.3;">${title}</h1>
                ${bodyHtml}
                <p style="margin:32px 0 0;padding-top:24px;border-top:1px solid #e9e9e9;font-size:12px;color:#6e6e6e;">
                  You are receiving this because someone signed up at
                  <a href="${siteUrl}" style="color:#000000;">${siteUrl.replace(/^https?:\/\//, '')}</a>.
                  If that was not you, you can ignore this message.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td style="background:#000000;border-radius:6px;">
      <a href="${href}" style="display:inline-block;padding:11px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">${label}</a>
    </td></tr>
  </table>`;
}

async function send(to: string, subject: string, html: string, text: string): Promise<SendResult> {
  const resend = getClient();
  if (!resend) return { sent: false, skipped: 'not_configured' };

  try {
    const { error } = await resend.emails.send({
      from: serverEnv.resendFromEmail,
      to,
      subject,
      html,
      text,
    });
    if (error) return { sent: false, error: error.message };
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : 'unknown error' };
  }
}

export async function sendWelcomeEmail(to: string, siteUrl: string): Promise<SendResult> {
  const html = wrap(
    'Welcome to Toolgraph',
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
       Your account is ready. Connect an MCP server, and every tool it exposes becomes a node you
       can wire up — with each connection type-checked against the tools' real schemas before it
       runs.
     </p>
     ${button(`${siteUrl}/graphs`, 'Open your graphs')}
     <p style="margin:0;font-size:14px;line-height:1.6;color:#6e6e6e;">
       When a graph is right, export it as TypeScript or Python. The generated code has no
       Toolgraph dependency — it is yours to keep.
     </p>`,
    siteUrl,
  );

  const text = [
    'Welcome to Toolgraph',
    '',
    'Your account is ready. Connect an MCP server, and every tool it exposes becomes a node you',
    "can wire up — with each connection type-checked against the tools' real schemas before it runs.",
    '',
    `Open your graphs: ${siteUrl}/graphs`,
    '',
    'When a graph is right, export it as TypeScript or Python. The generated code has no',
    'Toolgraph dependency — it is yours to keep.',
  ].join('\n');

  return send(to, 'Welcome to Toolgraph', html, text);
}

export async function sendConfirmSignupEmail(
  to: string,
  confirmUrl: string,
  siteUrl: string,
): Promise<SendResult> {
  const html = wrap(
    'Confirm your email',
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
       Confirm this address to finish setting up your Toolgraph account.
     </p>
     ${button(confirmUrl, 'Confirm email')}
     <p style="margin:0;font-size:13px;line-height:1.6;color:#6e6e6e;">
       This link expires in 24 hours. If the button does not work, paste this into your browser:<br />
       <span style="word-break:break-all;color:#000000;">${confirmUrl}</span>
     </p>`,
    siteUrl,
  );

  const text = [
    'Confirm your email',
    '',
    'Confirm this address to finish setting up your Toolgraph account:',
    confirmUrl,
    '',
    'This link expires in 24 hours.',
  ].join('\n');

  return send(to, 'Confirm your Toolgraph email', html, text);
}

export async function sendMagicLinkEmail(
  to: string,
  linkUrl: string,
  siteUrl: string,
): Promise<SendResult> {
  const html = wrap(
    'Your sign-in link',
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
       Use this link to sign in to Toolgraph. It works once, and expires in an hour.
     </p>
     ${button(linkUrl, 'Sign in')}
     <p style="margin:0;font-size:13px;line-height:1.6;color:#6e6e6e;">
       If you did not ask to sign in, you can ignore this message — the link is useless without
       access to this inbox.
     </p>`,
    siteUrl,
  );

  const text = [
    'Your Toolgraph sign-in link',
    '',
    linkUrl,
    '',
    'It works once, and expires in an hour.',
  ].join('\n');

  return send(to, 'Your Toolgraph sign-in link', html, text);
}

/**
 * Tells someone they have been invited to a workspace.
 *
 * Note what the link is NOT: a token. Acceptance requires being signed in as
 * the invited address, checked against auth.users by
 * `public.accept_workspace_invitation()`, so this URL is a signpost rather than
 * a credential — forwarding the mail does not transfer the invitation. That is
 * why it points at the settings page rather than at a one-click accept route.
 *
 * The workspace name comes from the database and is interpolated into HTML, so
 * it is escaped. A workspace called `<img onerror=...>` is somebody else's
 * choice of name arriving in a stranger's inbox otherwise.
 */
export async function sendWorkspaceInviteEmail(
  to: string,
  workspaceName: string,
  settingsUrl: string,
): Promise<SendResult> {
  const safeName = escapeHtml(workspaceName);

  const html = wrap(
    'You have been invited to a workspace',
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
       You have been invited to join <strong>${safeName}</strong> on Toolgraph — a shared
       workspace where graphs and connections are visible to everyone in it.
     </p>
     ${button(settingsUrl, 'Open your workspaces')}
     <p style="margin:0;font-size:14px;line-height:1.6;color:#6e6e6e;">
       Sign in with this address to accept. The invitation is tied to it, so forwarding this
       message does not pass it on. It expires in 14 days.
     </p>`,
    settingsUrl,
  );

  const text = [
    'You have been invited to a workspace',
    '',
    `You have been invited to join ${workspaceName} on Toolgraph — a shared workspace where`,
    'graphs and connections are visible to everyone in it.',
    '',
    `Open your workspaces: ${settingsUrl}`,
    '',
    'Sign in with this address to accept. The invitation is tied to it, so forwarding this',
    'message does not pass it on. It expires in 14 days.',
  ].join('\n');

  return send(to, `You have been invited to ${workspaceName} on Toolgraph`, html, text);
}
