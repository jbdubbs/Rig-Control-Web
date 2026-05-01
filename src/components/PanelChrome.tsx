import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../utils";

export interface PanelChromeProps {
  title?: string;
  icon?: React.ReactNode;
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  /** Replaces icon+title in the left slot when collapsed. Used by VfoPanel. */
  collapsedContent?: React.ReactNode;
  /** Rendered right of title, left of chevron. */
  headerActions?: React.ReactNode;
  /** Replaces the ENTIRE header interior (except chevron). Used by TabbedMeterPanel. */
  customHeaderContent?: React.ReactNode;
  children: React.ReactNode;
  /** Defaults to "p-4". */
  bodyClassName?: string;
  /** Applied to outer wrapper. */
  className?: string;
  /** sm = compact (py-2 px-3), md = phone (p-3). Defaults to "md". */
  headerSize?: "sm" | "md";
  /** Forwarded to outer div. Used by SpotsPanel for scroll-into-view. */
  outerRef?: React.RefObject<HTMLDivElement>;
  collapseTitle?: string;
}

const headerPaddingMap = {
  sm: "py-2 px-3",
  md: "p-3",
} as const;

const headerTextMap = {
  sm: "text-[0.5625rem]",
  md: "text-[0.5625rem]",
} as const;

const chevronSizeMap = { sm: 14, md: 16 } as const;

export default function PanelChrome({
  title,
  icon,
  isCollapsed,
  setIsCollapsed,
  collapsedContent,
  headerActions,
  customHeaderContent,
  children,
  bodyClassName,
  className,
  headerSize = "md",
  outerRef,
  collapseTitle,
}: PanelChromeProps) {
  const chevronSize = chevronSizeMap[headerSize];

  return (
    <div
      ref={outerRef}
      className={cn(
        "bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden",
        className
      )}
    >
      <div
        className={cn(
          headerPaddingMap[headerSize],
          "flex items-center justify-between bg-[#1a1b1e]",
          !isCollapsed && "border-b border-[#2a2b2e]"
        )}
      >
        {customHeaderContent ? (
          <div className="flex-1 flex items-center min-w-0">
            {customHeaderContent}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[#8e9299] flex-1 min-w-0">
              {isCollapsed && collapsedContent ? (
                collapsedContent
              ) : (
                <>
                  {icon}
                  {title && (
                    <span
                      className={cn(
                        headerTextMap[headerSize],
                        "uppercase tracking-widest font-bold"
                      )}
                    >
                      {title}
                    </span>
                  )}
                </>
              )}
            </div>
            {headerActions && (
              <div className="flex items-center gap-2 mx-2 flex-shrink-0">
                {headerActions}
              </div>
            )}
          </>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 hover:bg-white/5 rounded text-[#8e9299] flex-shrink-0"
          title={collapseTitle ?? (isCollapsed ? "Expand" : "Collapse")}
        >
          {isCollapsed ? (
            <ChevronDown size={chevronSize} />
          ) : (
            <ChevronUp size={chevronSize} />
          )}
        </button>
      </div>
      {!isCollapsed && (
        <div className={bodyClassName ?? "p-4"}>{children}</div>
      )}
    </div>
  );
}
