"use client";

import { useTransition } from "react";
import { acknowledgeAlert } from "@/lib/actions";
import { Button } from "@/components/ui/button";

export function AckAlertButton({ alertId }: { alertId: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => startTransition(() => acknowledgeAlert(alertId))}
    >
      {pending ? "…" : "Mark reviewed"}
    </Button>
  );
}
