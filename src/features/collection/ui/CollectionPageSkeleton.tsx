import { memo } from "react";

const TRACK_TITLE_WIDTHS = [
  "w-[38%]",
  "w-[48%]",
  "w-[32%]",
  "w-[44%]",
  "w-[54%]",
  "w-[36%]",
  "w-[46%]",
  "w-[40%]",
];

const TRACK_ARTIST_WIDTHS = [
  "w-[22%]",
  "w-[28%]",
  "w-[18%]",
  "w-[24%]",
  "w-[30%]",
  "w-[20%]",
  "w-[26%]",
  "w-[22%]",
];

export interface CollectionPageSkeletonProps {
  className?: string;
  isAlbum?: boolean;
}

// matches the sidebar + track list layout
function CollectionPageSkeletonComponent({
  className = "",
  isAlbum = true,
}: CollectionPageSkeletonProps) {
  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-transparent select-none ${className}`}
    >
      <div className="relative z-10 flex flex-row narrow:flex-col items-stretch gap-[16px] narrow:gap-0 pl-[32px] pr-[16px] narrow:px-[14px] h-full w-full min-h-0 box-border">
        <aside className="shrink-0 w-[280px] short:w-[220px] short:pt-[52px] self-start pt-[56px] pb-[24px] narrow:w-full narrow:pt-[52px] narrow:pb-[10px] narrow:grid narrow:grid-cols-[112px_minmax(0,1fr)] narrow:gap-x-[14px] narrow:items-center">
          <div className="relative aspect-square w-full overflow-hidden rounded-md bg-border-alpha-14 narrow:row-span-3">
            <div className="skeleton-shimmer h-full w-full" />
          </div>

          <div className="skeleton-shimmer h-[26px] w-[80%] rounded-[6px] mt-[16px] narrow:mt-0" />
          <div className="skeleton-shimmer h-[16px] w-[60%] rounded-[4px] mt-[6px]" />
          <div className="skeleton-shimmer h-[26px] w-[130px] rounded-md mt-[8px]" />

          <div className="skeleton-shimmer h-[36px] w-full rounded-md mt-[16px] narrow:mt-[14px] narrow:col-span-2" />
          <div className="mt-[8px] flex items-center gap-[8px] narrow:col-span-2">
            <div className="skeleton-shimmer h-[36px] flex-1 rounded-md" />
            <div className="skeleton-shimmer h-[36px] w-[36px] rounded-md" />
            <div className="skeleton-shimmer h-[36px] w-[36px] rounded-md" />
          </div>
        </aside>

        <div className="min-w-0 flex-1 h-full min-h-0 overflow-hidden px-[8px] narrow:px-0 pt-[56px] narrow:pt-0 pb-[24px]">
          <div className="flex flex-col">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md p-[8px] h-[64px]"
              >
                <div className="flex items-center gap-[16px] min-w-0 flex-1">
                  {isAlbum ? (
                    <div className="flex h-[48px] w-[48px] shrink-0 items-center justify-center">
                      <div className="skeleton-shimmer h-[14px] w-[18px] rounded-[3px]" />
                    </div>
                  ) : (
                    <div className="skeleton-shimmer h-[48px] w-[48px] shrink-0 rounded-md" />
                  )}

                  <div className="min-w-0 flex flex-col gap-[6px] flex-1">
                    <div
                      className={`skeleton-shimmer h-[15px] ${TRACK_TITLE_WIDTHS[i % TRACK_TITLE_WIDTHS.length]} rounded-[4px]`}
                    />
                    <div
                      className={`skeleton-shimmer h-[13px] ${TRACK_ARTIST_WIDTHS[i % TRACK_ARTIST_WIDTHS.length]} rounded-[4px]`}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-[16px] pr-[8px]">
                  <div className="skeleton-shimmer h-[13px] w-[36px] rounded-[4px]" />
                  <div className="skeleton-shimmer h-[32px] w-[32px] rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const CollectionPageSkeleton = memo(CollectionPageSkeletonComponent);
export default CollectionPageSkeleton;
