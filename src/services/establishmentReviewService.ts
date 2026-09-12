import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { logger } from "../utils/logger";
import { generatePublicId } from "./establishmentService";
import {
  sendEstablishmentApprovedEmail,
  sendEstablishmentInfoRequestedEmail,
  sendEstablishmentRejectedEmail,
  sendPublicIdRegeneratedEmail,
} from "./emailService";

/**
 * Examiner une demande d'etablissement, cote equipe SkillBridge.
 *
 * Deux principes gouvernent ce fichier.
 *
 * **L'e-mail n'est jamais le chemin de recuperation.** L'identifiant d'une
 * ecole est lisible dans le back-office et dans l'application du representant,
 * en permanence. Le courrier est une commodite posee par-dessus : un serveur
 * SMTP mal configure -- ce qui est le cas ici depuis le debut -- ne doit jamais
 * pouvoir enfermer une ecole dehors.
 *
 * **Un envoi rate se voit.** La decision, elle, est prise et enregistree ; mais
 * la reponse dit si le courrier est parti, pour qu'un administrateur sache
 * qu'il doit transmettre l'identifiant autrement.
 */

/** Le domaine d'une adresse ou d'une URL, ou null si illisible. */
const domaineDe = (valeur: string | null): string | null => {
  if (!valeur) return null;

  const brut = valeur.includes("@")
    ? valeur.split("@").pop()
    : (() => {
        try {
          return new URL(valeur).hostname;
        } catch {
          return null;
        }
      })();

  return brut ? brut.toLowerCase().replace(/^www\./, "") : null;
};

/**
 * Le signal de legitimite le plus fort qu'on puisse calculer.
 *
 * On demande une adresse officielle *distincte* de celle du demandeur
 * precisement pour verifier qu'il parle au nom de cet etablissement. Comparer
 * son domaine a celui du site declare repond en partie a la question, sans
 * qu'un relecteur ait a le faire de tete cinquante fois par semaine.
 *
 * Ce n'est pas une preuve : une ecole peut parfaitement n'avoir pas de site, ou
 * heberger son courrier ailleurs. D'ou trois reponses et non deux -- « on ne
 * peut pas dire » n'est pas « c'est suspect ».
 */
export type CorrespondanceDomaine = "match" | "mismatch" | "unknown";

export const comparerDomaines = (
  officialEmail: string | null,
  website: string | null
): CorrespondanceDomaine => {
  const a = domaineDe(officialEmail);
  const b = domaineDe(website);
  if (!a || !b) return "unknown";
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`) ? "match" : "mismatch";
};

/** Depuis combien de jours la demande attend une reponse de notre part. */
export const joursDAttente = (depuis: Date): number =>
  Math.floor((Date.now() - depuis.getTime()) / 86_400_000);

/** Ce que le back-office a besoin de savoir pour decider, et rien de moins. */
export const detailsPourExamen = async (organizationId: string) => {
  const o = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      campuses: {
        select: { id: true, name: true, city: true, country: true, isOnline: true },
      },
      requestedBy: {
        select: { id: true, firstName: true, lastName: true, email: true, createdAt: true },
      },
      _count: { select: { memberships: true, accessCodes: true } },
    },
  });
  if (!o) throw new HttpError(404, "Etablissement introuvable");

  return {
    ...o,
    // Champs calcules : le relecteur ne devrait pas avoir a les deduire.
    domainMatch: comparerDomaines(o.officialEmail, o.website),
    waitingDays: joursDAttente(o.createdAt),
    languages: o.languages ? (JSON.parse(o.languages) as string[]) : [],
    studyLevels: o.studyLevels ? (JSON.parse(o.studyLevels) as string[]) : [],
  };
};

/** L'adresse a laquelle ecrire, et le nom a qui s'adresser. */
const destinataire = (o: {
  officialEmail: string | null;
  contactEmail: string;
  contactName: string;
}) => ({
  // L'adresse officielle en priorite : c'est elle qu'on a demandee pour
  // verifier, donc celle que l'etablissement surveille.
  email: o.officialEmail ?? o.contactEmail,
  nom: o.contactName,
});

/**
 * Tente l'envoi sans jamais faire echouer la decision.
 *
 * Refuser une approbation parce qu'un serveur SMTP est indisponible serait
 * absurde : la decision est prise, elle est enregistree, et l'identifiant reste
 * lisible dans le back-office. On rapporte simplement si le courrier est parti.
 */
const tenterEnvoi = async (envoi: () => Promise<unknown>): Promise<boolean> => {
  try {
    await envoi();
    return true;
  } catch (error) {
    logger.warn({ err: error }, "Envoi d'e-mail d'etablissement echoue");
    return false;
  }
};

// --- Demander des informations ----------------------------------------------

/**
 * Poser une question sans refuser la demande.
 *
 * Sans cette action, un relecteur a qui il manque un detail n'a que deux
 * issues : refuser -- et l'ecole recommence tout le dossier -- ou approuver
 * sans savoir. La demande reste ouverte, et son statut dit qu'on attend l'ecole
 * et non l'inverse.
 */
export const demanderDesInformations = async (
  actorId: string,
  organizationId: string,
  message: string
) => {
  const o = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      status: true,
      officialEmail: true,
      contactEmail: true,
      contactName: true,
    },
  });
  if (!o) throw new HttpError(404, "Etablissement introuvable");
  if (o.status !== "PENDING" && o.status !== "INFO_REQUESTED") {
    throw new HttpError(400, "Cette demande a deja ete tranchee");
  }

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: { status: "INFO_REQUESTED", reviewedById: actorId, reviewNote: message },
    select: { id: true, name: true, status: true, reviewNote: true },
  });

  const cible = destinataire(o);
  const envoye = await tenterEnvoi(() =>
    sendEstablishmentInfoRequestedEmail({
      to: cible.email,
      contactName: cible.nom,
      organizationName: o.name,
      message,
    })
  );

  return { organization: updated, emailSent: envoye, emailTo: cible.email };
};

// --- Regenerer l'identifiant ------------------------------------------------

/**
 * Remet un identifiant d'etablissement perdu.
 *
 * A manier avec precaution : le representant s'en sert pour se connecter, donc
 * le regenerer coupe son acces jusqu'a ce qu'il connaisse le nouveau. C'est
 * pour cela qu'un motif est exige et que l'action est journalisee comme une
 * suspension le serait.
 *
 * Cela dit, la vraie recuperation ne passe pas par ici : l'identifiant courant
 * est affiche dans le back-office et dans l'application du representant. On ne
 * regenere que s'il a fuite, pas s'il a ete oublie.
 */
export const regenererPublicId = async (
  actorId: string,
  organizationId: string,
  reason: string
) => {
  const o = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      shortName: true,
      status: true,
      publicId: true,
      officialEmail: true,
      contactEmail: true,
      contactName: true,
    },
  });
  if (!o) throw new HttpError(404, "Etablissement introuvable");
  if (o.status !== "ACTIVE") {
    throw new HttpError(400, "Seul un etablissement actif possede un identifiant");
  }

  const ancien = o.publicId;
  const nouveau = await generatePublicId(o);

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: { publicId: nouveau },
    select: { id: true, name: true, publicId: true },
  });

  const cible = destinataire(o);
  const envoye = await tenterEnvoi(() =>
    sendPublicIdRegeneratedEmail({
      to: cible.email,
      contactName: cible.nom,
      organizationName: o.name,
      publicId: nouveau,
      reason,
    })
  );

  return { organization: updated, previousPublicId: ancien, emailSent: envoye, emailTo: cible.email };
};

// --- Notifier une decision --------------------------------------------------

/**
 * Previent l'etablissement du sort de sa demande.
 *
 * Appele apres que la decision est enregistree, jamais avant : un courrier
 * annoncant une validation qui n'aurait pas abouti serait pire que pas de
 * courrier du tout.
 */
export const notifierDecision = async (
  organizationId: string,
  decision: "ACTIVE" | "REJECTED",
  reason: string
): Promise<{ emailSent: boolean; emailTo: string }> => {
  const o = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      name: true,
      publicId: true,
      officialEmail: true,
      contactEmail: true,
      contactName: true,
    },
  });

  const cible = destinataire(o);

  const envoye = await tenterEnvoi(() =>
    decision === "ACTIVE"
      ? sendEstablishmentApprovedEmail({
          to: cible.email,
          contactName: cible.nom,
          organizationName: o.name,
          publicId: o.publicId ?? "",
        })
      : sendEstablishmentRejectedEmail({
          to: cible.email,
          contactName: cible.nom,
          organizationName: o.name,
          reason,
        })
  );

  return { emailSent: envoye, emailTo: cible.email };
};
