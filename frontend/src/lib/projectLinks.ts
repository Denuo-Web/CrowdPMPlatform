export const PROJECT_LINKS = {
  agpl3: "https://www.gnu.org/licenses/agpl-3.0.html",
  asanaBoard: "https://app.asana.com/1/941689499454829/project/1211814553979599/board",
  capstoneDrive: "https://drive.google.com/drive/folders/1Yh_4dku-TqYAlbGtKzT0UM0-LubAig17?usp=sharing",
  capstonePortal: "https://eecs.engineering.oregonstate.edu/capstone/submission/pages/viewSingleProject.php?id=WHBsGlAFvH7HrCiH",
  deepWiki: "https://deepwiki.com/Denuo-Web/CrowdPMPlatform",
  discord: "https://discord.gg/cEbGw8HAUQ",
  authorsFile: "https://github.com/Denuo-Web/CrowdPMPlatform/blob/main/AUTHORS.md",
  licenseFile: "https://github.com/Denuo-Web/CrowdPMPlatform/blob/main/LICENSE.md",
  noticeFile: "https://github.com/Denuo-Web/CrowdPMPlatform/blob/main/NOTICE.md",
  osuEecsProgram: "https://ecampus.oregonstate.edu/online-degrees/undergraduate/electrical-computer-engineering/",
  repository: "https://github.com/Denuo-Web/CrowdPMPlatform/",
  technicalRequirementsDoc: "https://docs.google.com/document/d/1i0fjx2_IagNerPkSPpG9JzbErKNKuu0caAm-F-koBTo/edit?usp=sharing",
} as const;

export const PROJECT_RESOURCE_LINKS = [
  { label: "Capstone Portal", href: PROJECT_LINKS.capstonePortal },
  { label: "Capstone Drive", href: PROJECT_LINKS.capstoneDrive },
  { label: "Technical Requirements Doc", href: PROJECT_LINKS.technicalRequirementsDoc },
  { label: "GitHub Monorepo", href: PROJECT_LINKS.repository },
  { label: "Deep Wiki", href: PROJECT_LINKS.deepWiki },
  { label: "Asana Board", href: PROJECT_LINKS.asanaBoard },
  { label: "Discord Invite", href: PROJECT_LINKS.discord },
] as const;
