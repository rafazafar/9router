import pkg from "../../../../package.json" with { type: "json" };

// Update check disabled — no npm/git polling.
export async function GET() {
  const currentVersion = pkg.version;
  return Response.json({ currentVersion, latestVersion: currentVersion, hasUpdate: false });
}
