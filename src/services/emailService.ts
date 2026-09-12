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


// --- Etablissements ---------------------------------------------------------

/**
 * Le courrier n'est jamais le chemin de recuperation.
 *
 * L'identifiant d'une ecole reste lisible dans le back-office et dans
 * l'application de son representant. Ces envois sont une commodite posee
 * par-dessus : hors production, l'absence de SMTP est journalisee et la
 * fonction rend la main, pour qu'un serveur mal configure ne puisse jamais
 * bloquer une decision deja prise.
 */
const envoyerOuJournaliser = async (
  input: { to: string; subject: string; html: string },
  contexte: Record<string, unknown>
): Promise<void> => {
  if (!isConfigured()) {
    if (env.nodeEnv === "production") {
      throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD are required in production");
    }
    logger.warn({ to: input.to, ...contexte }, "Email non configure, contenu journalise");
    return;
  }

  await getTransport().sendMail({
    from: FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
};

export const sendEstablishmentApprovedEmail = async (input: {
  to: string;
  contactName: string;
  organizationName: string;
  publicId: string;
}): Promise<void> => {
  const nom = escapeHtml(input.contactName);
  const ecole = escapeHtml(input.organizationName);
  const id = escapeHtml(input.publicId);

  await envoyerOuJournaliser(
    {
      to: input.to,
      subject: `${input.organizationName} est validé — votre identifiant SkillBridge`,
      html: emailWrapper(`
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#252840;letter-spacing:-0.5px;">
          Votre établissement est validé
        </h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:23px;color:#756B5B;">
          Bonjour ${nom}, la demande d'inscription de <strong>${ecole}</strong> a été acceptée.
        </p>
        <p style="margin:0 0 10px;font-size:14px;line-height:21px;color:#756B5B;">
          Voici l'identifiant de votre structure :
        </p>
        <div style="margin:0 0 18px;padding:16px;background:#F4F2ED;border-radius:14px;text-align:center;">
          <span style="font-size:22px;font-weight:900;letter-spacing:2px;color:#252840;">${id}</span>
        </div>
        <p style="margin:0 0 18px;font-size:14px;line-height:21px;color:#756B5B;">
          Il vous sert à ouvrir votre espace : dans l'application, choisissez
          <strong>Se connecter → Mon établissement</strong>, puis saisissez votre adresse,
          votre mot de passe et cet identifiant.
        </p>
        <p style="margin:0;font-size:13px;line-height:20px;color:#7A6E5C;">
          Vous le retrouverez toujours dans l'application, sur la page de votre établissement :
          inutile de conserver ce message.
        </p>
      `),
    },
    { organizationName: input.organizationName, publicId: input.publicId }
  );
};

export const sendEstablishmentRejectedEmail = async (input: {
  to: string;
  contactName: string;
  organizationName: string;
  reason: string;
}): Promise<void> => {
  const nom = escapeHtml(input.contactName);
  const ecole = escapeHtml(input.organizationName);
  const motif = escapeHtml(input.reason);

  await envoyerOuJournaliser(
    {
      to: input.to,
      subject: `Votre demande pour ${input.organizationName}`,
      html: emailWrapper(`
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#252840;letter-spacing:-0.5px;">
          Votre demande n'a pas été retenue
        </h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:23px;color:#756B5B;">
          Bonjour ${nom}, la demande d'inscription de <strong>${ecole}</strong> n'a pas abouti.
        </p>
        <div style="margin:0 0 18px;padding:16px;background:#F4F2ED;border-radius:14px;">
          <p style="margin:0;font-size:14px;line-height:21px;color:#252840;">${motif}</p>
        </div>
        <p style="margin:0;font-size:14px;line-height:21px;color:#756B5B;">
          Si les éléments manquants peuvent être fournis, vous pouvez déposer une nouvelle
          demande depuis l'application.
        </p>
      `),
    },
    { organizationName: input.organizationName }
  );
};

export const sendEstablishmentInfoRequestedEmail = async (input: {
  to: string;
  contactName: string;
  organizationName: string;
  message: string;
}): Promise<void> => {
  const nom = escapeHtml(input.contactName);
  const ecole = escapeHtml(input.organizationName);
  const question = escapeHtml(input.message);

  await envoyerOuJournaliser(
    {
      to: input.to,
      subject: `Une précision sur votre demande — ${input.organizationName}`,
      html: emailWrapper(`
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#252840;letter-spacing:-0.5px;">
          Il nous manque une précision
        </h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:23px;color:#756B5B;">
          Bonjour ${nom}, nous examinons la demande de <strong>${ecole}</strong> et
          aurions besoin du point suivant :
        </p>
        <div style="margin:0 0 18px;padding:16px;background:#F4F2ED;border-radius:14px;">
          <p style="margin:0;font-size:14px;line-height:21px;color:#252840;">${question}</p>
        </div>
        <p style="margin:0;font-size:14px;line-height:21px;color:#756B5B;">
          Répondez simplement à ce message. Votre demande reste ouverte en attendant.
        </p>
      `),
    },
    { organizationName: input.organizationName }
  );
};

export const sendPublicIdRegeneratedEmail = async (input: {
  to: string;
  contactName: string;
  organizationName: string;
  publicId: string;
  reason: string;
}): Promise<void> => {
  const nom = escapeHtml(input.contactName);
  const ecole = escapeHtml(input.organizationName);
  const id = escapeHtml(input.publicId);
  const motif = escapeHtml(input.reason);

  await envoyerOuJournaliser(
    {
      to: input.to,
      subject: `Nouvel identifiant pour ${input.organizationName}`,
      html: emailWrapper(`
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#252840;letter-spacing:-0.5px;">
          Votre identifiant a été renouvelé
        </h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:23px;color:#756B5B;">
          Bonjour ${nom}, l'identifiant de <strong>${ecole}</strong> a été remplacé.
          <strong>L'ancien ne fonctionne plus.</strong>
        </p>
        <div style="margin:0 0 18px;padding:16px;background:#F4F2ED;border-radius:14px;text-align:center;">
          <span style="font-size:22px;font-weight:900;letter-spacing:2px;color:#252840;">${id}</span>
        </div>
        <div style="margin:0 0 18px;padding:16px;background:#F4F2ED;border-radius:14px;">
          <p style="margin:0;font-size:14px;line-height:21px;color:#252840;">${motif}</p>
        </div>
        <p style="margin:0;font-size:13px;line-height:20px;color:#7A6E5C;">
          Vous le retrouverez toujours dans l'application, sur la page de votre établissement.
        </p>
      `),
    },
    { organizationName: input.organizationName, publicId: input.publicId }
  );
};
