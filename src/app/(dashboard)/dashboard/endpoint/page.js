import EndpointPageClient from "./EndpointPageClient";
import { requireUser } from "@/lib/auth/authorization";

export default async function EndpointPage() {
  const principal = await requireUser();
  return <EndpointPageClient isAdmin={principal.role === "admin"} />;
}
