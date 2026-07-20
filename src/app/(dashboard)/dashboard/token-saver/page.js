import TokenSaverClient from "./TokenSaverClient";
import MemberTokenSaverClient from "./MemberTokenSaverClient";
import { requireUser } from "@/lib/auth/authorization";

export default async function TokenSaverPage() {
  const principal = await requireUser();
  return principal.role === "admin" ? <TokenSaverClient /> : <MemberTokenSaverClient />;
}
