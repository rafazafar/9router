import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import ProviderLimits from "../usage/components/ProviderLimits";
import { requireUser } from "@/lib/auth/authorization";

export default async function QuotaPage() {
  const principal = await requireUser();
  return (
    <Suspense fallback={<CardSkeleton />}>
      <ProviderLimits isAdmin={principal.role === "admin"} />
    </Suspense>
  );
}
