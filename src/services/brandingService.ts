import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { requireOrgAdmin } from "./organizationService";

/**
 * L'identite visuelle d'un etablissement.
 *
 * Ce que la couleur d'une ecole touche, et ce qu'elle ne touche pas, est decide
 * ici et respecte partout : elle teinte l'en-tete d'accueil, les formes des
 * etats vides et les marqueurs d'appartenance. Elle ne touche jamais les
 * boutons d'action, le texte courant ni les etats d'erreur.
 *
 * La raison est simple : une ecole dont le logo est jaune vif produirait des
 * boutons illisibles, et une ecole dont la couleur est rouge ferait passer
 * chacune de ses reussites pour une alerte. Une identite ne doit pas pouvoir
 * casser une interface.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Le texte a poser sur une couleur : blanc ou sombre.
 *
 * On compare les deux rapports de contraste reels -- celui du blanc et celui du
 * noir sur cette couleur -- et on garde le meilleur. Un simple seuil de
 * luminosite se trompe : sur un bleu clair comme #7ec8e3 il choisissait du
 * blanc, dont le contraste tombe a 1,9 pour 1, illisible, quand le noir offre
 * 11 pour 1.
 *
 * La formule est celle des WCAG. Elle vit cote serveur pour que les trois
 * clients ne puissent pas en donner trois reponses differentes -- et c'est la
 * lisibilite d'un titre qui en depend.
 */
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const texteSurCouleur = (hex: string): "light" | "dark" => {
  const l = luminance(hex);
  const contrasteDuBlanc = 1.05 / (l + 0.05);
  const contrasteDuNoir = (l + 0.05) / 0.05;
  return contrasteDuBlanc >= contrasteDuNoir ? "light" : "dark";
};

/**
 * Le rapport de contraste obtenu, entre 1 et 21.
 *
 * Expose pour que l'ecran de reglage puisse avertir : une ecole qui choisit une
 * couleur sous 4,5 pour 1 doit le savoir avant que ses membres ne decouvrent un
 * titre illisible.
 */
export const contrasteObtenu = (hex: string): number => {
  const l = luminance(hex);
  return Math.round(Math.max(1.05 / (l + 0.05), (l + 0.05) / 0.05) * 10) / 10;
};

/** L'identite telle que les clients la lisent, avec ce qui en decoule. */
export const identiteDe = (o: {
  logoUrl: string | null;
  bannerUrl: string | null;
  brandColor: string | null;
}) => ({
  logoUrl: o.logoUrl,
  bannerUrl: o.bannerUrl,
  brandColor: o.brandColor,
  /**
   * Calcule ici et pas dans chaque client : trois applications qui refont le
   * meme calcul finissent par ne plus etre d'accord, et c'est la lisibilite
   * d'un texte qui en depend.
   */
  onBrand: o.brandColor ? texteSurCouleur(o.brandColor) : null,
  /** Vrai quand il reste quelque chose a poser. Pilote le rappel dans l'app. */
  incomplete: !o.logoUrl || !o.brandColor,
});

export const lireIdentite = async (userId: string) => {
  const { organizationId } = await requireOrgAdmin(userId);

  const o = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      shortName: true,
      logoUrl: true,
      bannerUrl: true,
      brandColor: true,
    },
  });

  return { ...o, ...identiteDe(o) };
};

/**
 * Met a jour l'identite. Administrateurs uniquement.
 *
 * Un professeur ne change pas les couleurs de son etablissement : ce n'est pas
 * une preference personnelle, c'est ce que tous les membres verront.
 *
 * Chaque champ est optionnel et independant : on demande le logo d'abord, la
 * couleur ensuite, la banniere plus tard. Un formulaire qui exige trois
 * televersements d'un coup se referme sans etre rempli.
 */
export const mettreAJourIdentite = async (
  userId: string,
  patch: { logoUrl?: string | null; bannerUrl?: string | null; brandColor?: string | null }
) => {
  const { organizationId } = await requireOrgAdmin(userId);

  if (patch.brandColor && !HEX.test(patch.brandColor)) {
    throw new HttpError(400, "La couleur doit etre au format #RRGGBB");
  }

  const o = await prisma.organization.update({
    where: { id: organizationId },
    data: {
      ...(patch.logoUrl !== undefined ? { logoUrl: patch.logoUrl } : {}),
      ...(patch.bannerUrl !== undefined ? { bannerUrl: patch.bannerUrl } : {}),
      ...(patch.brandColor !== undefined
        ? { brandColor: patch.brandColor?.toLowerCase() ?? null }
        : {}),
    },
    select: {
      id: true,
      name: true,
      shortName: true,
      logoUrl: true,
      bannerUrl: true,
      brandColor: true,
    },
  });

  return { ...o, ...identiteDe(o) };
};
