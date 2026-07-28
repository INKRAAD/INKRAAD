import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const username = process.env.GITHUB_REPOSITORY_OWNER || "INKRAAD";
const token = process.env.GITHUB_TOKEN;
const outputDir = process.env.OUTPUT_DIR || "dist";

if (!token) {
  throw new Error("GITHUB_TOKEN is required to generate profile visuals.");
}

const now = new Date();
const from = new Date(now);
from.setUTCFullYear(now.getUTCFullYear() - 1);

const query = `
  query ProfileVisuals($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      login
      createdAt
      followers { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC) {
        totalCount
        nodes { stargazerCount primaryLanguage { name color } }
      }
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "INKRAAD-profile-visuals",
  },
  body: JSON.stringify({ query, variables: { login: username, from: from.toISOString(), to: now.toISOString() } }),
});

const payload = await response.json();
if (!response.ok || payload.errors) {
  throw new Error(`GitHub GraphQL request failed: ${JSON.stringify(payload.errors || payload)}`);
}

const { user } = payload.data;
const contributionData = user.contributionsCollection;
const days = contributionData.contributionCalendar.weeks
  .flatMap((week) => week.contributionDays)
  .sort((a, b) => a.date.localeCompare(b.date));

let currentStreak = 0;
for (const day of [...days].reverse()) {
  if (day.contributionCount <= 0) break;
  currentStreak += 1;
}

let longestStreak = 0;
let runningStreak = 0;
for (const day of days) {
  runningStreak = day.contributionCount > 0 ? runningStreak + 1 : 0;
  longestStreak = Math.max(longestStreak, runningStreak);
}

const languageCount = new Map();
let stars = 0;
for (const repository of user.repositories.nodes) {
  stars += repository.stargazerCount;
  if (repository.primaryLanguage) {
    const language = repository.primaryLanguage;
    const current = languageCount.get(language.name) || { count: 0, color: language.color || "#8b949e" };
    current.count += 1;
    languageCount.set(language.name, current);
  }
}

const languages = [...languageCount.entries()]
  .map(([name, value]) => ({ name, ...value }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  .slice(0, 4);

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const short = (value) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const monthsSince = Math.max(1, Math.floor((now - new Date(user.createdAt)) / (1000 * 60 * 60 * 24 * 30.44)));
const experience = monthsSince < 6 ? "New Builder" : monthsSince < 18 ? "Junior Dev" : monthsSince < 36 ? "Growing Developer" : "Seasoned Builder";

const svgShell = (content, height) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0d1117"/><stop offset="1" stop-color="#161b22"/></linearGradient>
    <linearGradient id="violet" x1="0" x2="1"><stop stop-color="#7c3aed"/><stop offset="1" stop-color="#06b6d4"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="1200" height="${height}" rx="24" fill="url(#bg)"/>
  ${content}
</svg>`;

const metricCard = (x, label, value, accent, note) => `
  <rect x="${x}" y="44" width="258" height="148" rx="18" fill="#0d1117" stroke="#30363d"/>
  <rect x="${x}" y="44" width="258" height="6" rx="3" fill="${accent}"/>
  <text x="${x + 24}" y="84" fill="#8b949e" font-family="Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(label.toUpperCase())}</text>
  <text x="${x + 24}" y="136" fill="#f0f6fc" font-family="Arial, sans-serif" font-size="42" font-weight="800">${escapeXml(short(value))}</text>
  <text x="${x + 24}" y="168" fill="${accent}" font-family="Arial, sans-serif" font-size="15">${escapeXml(note)}</text>`;

const metricsSvg = svgShell(`
  <text x="48" y="30" fill="#f0f6fc" font-family="Arial, sans-serif" font-size="20" font-weight="800">INKRAAD · GitHub Pulse</text>
  <text x="1152" y="30" text-anchor="end" fill="#8b949e" font-family="Arial, sans-serif" font-size="14">actualizado diariamente</text>
  ${metricCard(48, "Contribuciones", contributionData.contributionCalendar.totalContributions, "#7c3aed", "últimos 365 días")}
  ${metricCard(330, "Racha actual", currentStreak, "#06b6d4", "días consecutivos")}
  ${metricCard(612, "Mejor racha", longestStreak, "#f472b6", "récord personal")}
  ${metricCard(894, "Repos públicos", user.repositories.totalCount, "#34d399", "proyectos visibles")}
`, 236);

const trophyDefinitions = [
  ["Experience", `${monthsSince} mo`, experience, "#7c3aed"],
  ["Commits", contributionData.totalCommitContributions, "Contributions", "#06b6d4"],
  ["Repositories", user.repositories.totalCount, "Public builder", "#34d399"],
  ["Stars", stars, "Community signal", "#facc15"],
  ["Followers", user.followers.totalCount, "Network", "#f472b6"],
  ["Issues", contributionData.totalIssueContributions, "Problem solver", "#fb7185"],
  ["Pull requests", contributionData.totalPullRequestContributions, "Collaborator", "#60a5fa"],
  ["Reviews", contributionData.totalPullRequestReviewContributions, "Quality eye", "#a78bfa"],
];

const trophyCards = trophyDefinitions.map(([title, score, subtitle, color], index) => {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const x = 42 + col * 290;
  const y = 48 + row * 164;
  return `
    <rect x="${x}" y="${y}" width="256" height="132" rx="16" fill="#161b22" stroke="#30363d"/>
    <circle cx="${x + 36}" cy="${y + 37}" r="16" fill="${color}" opacity="0.18"/>
    <path d="M ${x + 30} ${y + 26} h 12 l -2 17 h -8 z M ${x + 26} ${y + 45} h 20 M ${x + 31} ${y + 49} h 10" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <text x="${x + 62}" y="${y + 36}" fill="#c9d1d9" font-family="Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(title)}</text>
    <text x="${x + 24}" y="${y + 88}" fill="#f0f6fc" font-family="Arial, sans-serif" font-size="30" font-weight="800">${escapeXml(short(score))}</text>
    <text x="${x + 24}" y="${y + 112}" fill="${color}" font-family="Arial, sans-serif" font-size="14">${escapeXml(subtitle)}</text>`;
}).join("\n");

const trophiesSvg = svgShell(`
  <text x="42" y="30" fill="#f0f6fc" font-family="Arial, sans-serif" font-size="20" font-weight="800">INKRAAD · Trophy Cabinet</text>
  <text x="1158" y="30" text-anchor="end" fill="#8b949e" font-family="Arial, sans-serif" font-size="14">logros basados en actividad pública</text>
  ${trophyCards}
`, 390);

const languageRows = languages.length
  ? languages.map((language, index) => {
      const y = 80 + index * 42;
      const width = Math.max(56, Math.round((language.count / languages[0].count) * 760));
      return `
        <text x="52" y="${y + 18}" fill="#c9d1d9" font-family="Arial, sans-serif" font-size="17" font-weight="700">${escapeXml(language.name)}</text>
        <rect x="236" y="${y}" width="800" height="22" rx="11" fill="#21262d"/>
        <rect x="236" y="${y}" width="${width}" height="22" rx="11" fill="${language.color}"/>
        <text x="1068" y="${y + 18}" fill="#8b949e" font-family="Arial, sans-serif" font-size="15">${language.count} repo${language.count === 1 ? "" : "s"}</text>`;
    }).join("\n")
  : `<text x="600" y="150" text-anchor="middle" fill="#8b949e" font-family="Arial, sans-serif" font-size="20">Los lenguajes aparecerán aquí cuando publiques proyectos con código.</text>`;

const languagesSvg = svgShell(`
  <text x="48" y="36" fill="#f0f6fc" font-family="Arial, sans-serif" font-size="20" font-weight="800">Lenguajes por repositorio público</text>
  ${languageRows}
`, 280);

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(join(outputDir, "profile-metrics.svg"), metricsSvg),
  writeFile(join(outputDir, "profile-trophies.svg"), trophiesSvg),
  writeFile(join(outputDir, "profile-languages.svg"), languagesSvg),
]);

console.log(`Generated profile SVGs for ${username}.`);
