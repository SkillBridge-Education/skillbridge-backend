import { logger } from "../utils/logger";
import nodemailer from "nodemailer";
import { env } from "../utils/env";

const FROM = `"SkillBridge" <${env.gmailUser || "no-reply@skillbridge.app"}>`;

// Tests must never reach a real SMTP server: it makes the suite slow, flaky and
// dependent on live credentials, and it would mail real addresses.
const isConfigured = () =>
  process.env.NODE_ENV !== "test" && Boolean(env.gmailUser && env.gmailAppPassword);

const getTransport = () =>
  nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: env.gmailUser,
      pass: env.gmailAppPassword,
    },
  });

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const emailWrapper = (content: string): string => `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#FDFAF4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FDFAF4;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <tr>
            <td style="padding-bottom:28px;text-align:center;">
              <span style="display:inline-block;background:#C8864B;border-radius:10px;width:36px;height:36px;line-height:36px;text-align:center;vertical-align:middle;">
                <span style="font-size:18px;font-weight:900;color:white;">S</span>
              </span>
              <span style="font-size:20px;font-weight:900;color:#252840;margin-left:10px;vertical-align:middle;letter-spacing:-0.5px;">
                Skill<span style="color:#C8864B;">Bridge</span>
              </span>
            </td>
          </tr>

          <tr>
            <td style="background:white;border-radius:24px;border:1px solid #E8DDC7;padding:36px 40px;">
              ${content}
              <div style="background:#FDFAF4;border-radius:12px;padding:14px 18px;margin-top:28px;">
                <p style="margin:0;font-size:13px;color:#756B5B;line-height:1.6;">
                  Si tu ne vois pas cet email, pense a verifier ton dossier
                  <strong>spam&nbsp;/&nbsp;courrier indesirable</strong>.
                </p>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding-top:20px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#B0A898;line-height:1.6;">
                Tu recois cet email car tu as un compte SkillBridge.<br>
                Si tu n'es pas a l'origine de cette action, tu peux ignorer ce message.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const actionButton = (href: string, label: string): string =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td align="center">
        <a href="${href}"
           style="display:inline-block;background:#D98E4A;color:white;text-decoration:none;
                  font-weight:700;font-size:15px;padding:14px 36px;border-radius:50px;
                  letter-spacing:0.1px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;

const backupLink = (href: string): string =>
  `<p style="margin:16px 0 0;font-size:13px;color:#B0A898;line-height:1.6;">
    Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur&nbsp;:
  </p>
  <p style="margin:6px 0 0;font-size:12px;word-break:break-all;">
    <a href="${href}" style="color:#C8864B;">${href}</a>
  </p>`;

export const buildVerificationUrl = (token: string): string => {
  const base = env.frontendUrl.replace(/\/$/, "");
  return `${base}/verify-email?token=${encodeURIComponent(token)}`;
};

export const sendVerificationEmail = async (input: {
  to: string;
  firstName: string;
  verificationUrl: string;
  expiresInHours: number;
}): Promise<void> => {
  const safeFirst = escapeHtml(input.firstName);
  const safeUrl   = escapeHtml(input.verificationUrl);

  if (!isConfigured()) {
    if (env.nodeEnv === "production") {
      throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD are required in production");
    }
    // Outside production the link is logged so local sign-up still works
    // without SMTP credentials.
    logger.warn(
      { to: input.to, verificationUrl: input.verificationUrl },
      "Email not configured, verification link logged instead of sent"
    );
    return;
  }

  const subject = "Confirme ton adresse email — SkillBridge";

  const html = emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#252840;letter-spacing:-0.5px;">
      Confirme ton adresse email
    </h1>
    <p style="margin:0 0 4px;font-size:15px;color:#756B5B;line-height:1.6;">
      Salut <strong style="color:#252840;">${safeFirst}</strong>, bienvenue sur SkillBridge !
    </p>
    <p style="margin:0;font-size:14px;color:#756B5B;line-height:1.6;">
      Clique sur le bouton ci-dessous pour activer ton compte.
      Ce lien expire dans <strong>${input.expiresInHours}&nbsp;heures</strong>.
    </p>
    ${actionButton(safeUrl, "Confirmer mon adresse email")}
    ${backupLink(safeUrl)}
  `);

  const text = [
    `Salut ${input.firstName},`,
    "",
    "Bienvenue sur SkillBridge ! Confirme ton adresse email pour activer ton compte.",
    "",
    `Lien de confirmation : ${input.verificationUrl}`,
    "",
    `Ce lien expire dans ${input.expiresInHours} heures.`,
    "",
    "Si tu ne vois pas cet email, verifie ton dossier spam.",
    "Si tu n'as pas cree de compte SkillBridge, ignore ce message.",
  ].join("\n");

  await getTransport().sendMail({ from: FROM, to: input.to, subject, html, text });
  logger.info({ to: input.to }, "Verification email sent");
};

export const sendPasswordResetEmail = async (input: {
  to: string;
  resetUrl: string;
}): Promise<void> => {
  const safeUrl = escapeHtml(input.resetUrl);

  if (!isConfigured()) {
    if (env.nodeEnv === "production") {
      throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD are required in production");
    }
    logger.warn(
      { to: input.to, resetUrl: input.resetUrl },
      "Email not configured, reset link logged instead of sent"
    );
    return;
  }

  const subject = "Reinitialise ton mot de passe — SkillBridge";

  const html = emailWrapper(`
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#252840;letter-spacing:-0.5px;">
      Reinitialise ton mot de passe
    </h1>
    <p style="margin:0;font-size:14px;color:#756B5B;line-height:1.6;">
      Une demande de reinitialisation de mot de passe a ete effectuee pour ton compte SkillBridge.
      Clique sur le bouton ci-dessous pour choisir un nouveau mot de passe.
      Ce lien expire dans <strong>1&nbsp;heure</strong>.
    </p>
    ${actionButton(safeUrl, "Reinitialiser mon mot de passe")}
    ${backupLink(safeUrl)}
    <p style="margin:20px 0 0;font-size:13px;color:#B0A898;line-height:1.6;">
      Si tu n'as pas demande de reinitialisation, tu peux ignorer cet email.
      Ton mot de passe reste inchange.
    </p>
  `);

  const text = [
    "Une demande de reinitialisation de mot de passe a ete effectuee pour ton compte SkillBridge.",
    "",
    `Reinitialise ton mot de passe : ${input.resetUrl}`,
    "",
    "Ce lien expire dans 1 heure.",
    "",
    "Si tu ne vois pas cet email, verifie ton dossier spam.",
    "Si tu n'as pas fait cette demande, ignore ce message.",
  ].join("\n");

  await getTransport().sendMail({ from: FROM, to: input.to, subject, html, text });
  logger.info({ to: input.to }, "Password reset email sent");
};
