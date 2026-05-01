import React from "react";

export interface SpotsPanelProps {
  type: "pota" | "sota";
  renderTable: () => React.ReactElement;
}

export default function SpotsPanel({
  renderTable,
}: SpotsPanelProps) {
  return (
    <div className="overflow-x-auto">
      {renderTable()}
    </div>
  );
}
