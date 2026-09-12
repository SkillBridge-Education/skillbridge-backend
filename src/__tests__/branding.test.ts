import { describe, expect, it } from "vitest";
import { contrasteObtenu, identiteDe, texteSurCouleur } from "../services/brandingService";

/**
 * L'identite visuelle d'un etablissement.
 *
 * Ce qui est teste ici n'est pas une preference esthetique : c'est qu'une ecole
 * ne puisse pas rendre sa propre page d'accueil illisible en choisissant sa
 * couleur. Le calcul vit cote serveur pour que les trois clients ne puissent
 * pas en donner trois reponses differentes.
 */
describe("Identite d'etablissement", () => {
  describe("le texte pose sur la couleur", () => {
    it("choisit du blanc sur une couleur sombre", () => {
      expect(texteSurCouleur("#252840")).toBe("light");
      expect(texteSurCouleur("#000000")).toBe("light");
      expect(texteSurCouleur("#1a3a6b")).toBe("light");
    });

    it("choisit du sombre sur une couleur claire", () => {
      // Le cas qui motive tout : une ecole au jaune pale se retrouverait avec
      // un titre blanc invisible sur sa propre page d'accueil.
      expect(texteSurCouleur("#ffffff")).toBe("dark");
      expect(texteSurCouleur("#ffe066")).toBe("dark");
      expect(texteSurCouleur("#a8e6cf")).toBe("dark");
    });

    it("prefere le sombre sur un ton moyen, meme quand l'oeil hesite", () => {
      // Un simple seuil de luminosite se trompait ici : sur ce bleu clair il
      // choisissait du blanc, dont le contraste tombe a 1,9 pour 1 quand le
      // noir offre 11 pour 1. On compare donc les deux rapports reels.
      expect(texteSurCouleur("#7ec8e3")).toBe("dark");
      expect(texteSurCouleur("#c8864b")).toBe("dark");
    });

    it("chiffre le contraste obtenu, pour pouvoir avertir", () => {
      // Une ecole qui choisit une couleur sous 4,5 pour 1 doit le savoir avant
      // que ses membres ne decouvrent un titre illisible.
      expect(contrasteObtenu("#000000")).toBeGreaterThan(15);
      expect(contrasteObtenu("#ffffff")).toBeGreaterThan(15);
      expect(contrasteObtenu("#808080")).toBeLessThan(6);
    });

    it("reste lisible quelle que soit la couleur", () => {
      // Aucune couleur ne doit produire un resultat absent ou inattendu.
      for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#808080", "#fefefe", "#010101"]) {
        expect(["light", "dark"]).toContain(texteSurCouleur(hex));
      }
    });
  });

  describe("l'etat de l'identite", () => {
    it("se dit incomplete tant qu'il manque le logo ou la couleur", () => {
      // C'est ce qui pilote le rappel discret dans l'espace etablissement.
      expect(identiteDe({ logoUrl: null, bannerUrl: null, brandColor: null }).incomplete).toBe(true);
      expect(
        identiteDe({ logoUrl: "/uploads/avatars/a.webp", bannerUrl: null, brandColor: null })
          .incomplete
      ).toBe(true);
      expect(
        identiteDe({ logoUrl: null, bannerUrl: null, brandColor: "#1a3a6b" }).incomplete
      ).toBe(true);
    });

    it("se dit complete avec un logo et une couleur, sans banniere", () => {
      // La banniere vient plus tard, quand elle sert : l'exiger d'emblee
      // ferait abandonner le formulaire.
      const identite = identiteDe({
        logoUrl: "/uploads/avatars/a.webp",
        bannerUrl: null,
        brandColor: "#1a3a6b",
      });
      expect(identite.incomplete).toBe(false);
      expect(identite.onBrand).toBe("light");
    });

    it("ne calcule aucun contraste sans couleur", () => {
      expect(identiteDe({ logoUrl: null, bannerUrl: null, brandColor: null }).onBrand).toBeNull();
    });
  });
});
