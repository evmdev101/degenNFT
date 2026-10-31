import * as nftPage from "../features/nft/NftPage";

export const pageLoaders = {
  "/": () => import("../features/OverviewPage"),
  "/portfolio": () => import("../features/PortfolioPage"),
  "/nft": () => Promise.resolve(nftPage),
  "/my-miners": () => import("../features/MinersHubPage"),
  "/farms": () => import("../features/FarmsPage"),
  "/governance": () => import("../features/GovernancePage"),
  "/how-it-works": () => import("../features/HowItWorksPage"),
  "/protocol": () => import("../features/DocsPage"),
};

export function preloadPage(path: string) {
  const loader = pageLoaders[path as keyof typeof pageLoaders];
  if (loader) void loader().catch(() => undefined);
}
