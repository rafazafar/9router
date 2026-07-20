import { getMachineId } from "@/shared/utils/machine";
import CLIToolsPageClient from "./CLIToolsPageClient";
import MemberCLIToolsPage from "./MemberCLIToolsPage";
import { requireUser } from "@/lib/auth/authorization";

export default async function CLIToolsPage() {
  const principal = await requireUser();
  if (principal.role === "member") return <MemberCLIToolsPage />;
  const machineId = await getMachineId();
  return <CLIToolsPageClient machineId={machineId} />;
}
