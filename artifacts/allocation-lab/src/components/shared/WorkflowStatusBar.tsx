import { STAGE_LABELS } from "@/lib/workflow";

export function WorkflowStatusBar({ stage }: { stage: number }) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-center min-w-max py-1">
        {STAGE_LABELS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1 px-1.5">
              <div
                className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                  i < stage ? "bg-primary" : i === stage ? "bg-accent ring-2 ring-accent/30" : "bg-gray-200"
                }`}
              />
              <span
                className={`text-[9.5px] whitespace-nowrap ${
                  i <= stage ? "text-gray-700 font-medium" : "text-gray-400"
                }`}
              >
                {label}
              </span>
            </div>
            {i < STAGE_LABELS.length - 1 && <div className="w-4 sm:w-6 h-px bg-gray-200 mb-3.5" />}
          </div>
        ))}
      </div>
    </div>
  );
}
