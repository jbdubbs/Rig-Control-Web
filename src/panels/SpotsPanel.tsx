import React from "react";
import { cn } from "../utils";

export interface SpotsPanelProps {
  variant: "phone" | "desktop";
  type: "pota" | "sota";
  renderTable: () => React.ReactElement;
}

export default function SpotsPanel({
  variant,
  renderTable,
}: SpotsPanelProps) {
  const isDesktop = variant === "desktop";

  return (
    <div
      className={cn(
        "overflow-x-auto",
        isDesktop && "max-h-72 overflow-y-auto custom-scrollbar"
      )}
    >
      {renderTable()}
    </div>
  );
}
