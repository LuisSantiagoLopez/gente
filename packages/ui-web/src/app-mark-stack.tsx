import { cn } from "./lib/utils.js";
import { LogoTile } from "./logo-tile.js";

type AppMark = { name: string; logo?: string | null };

/** Decorative catalog artwork; the containing control supplies its accessible name. */
export function AppMarkStack({
  marks,
  size = 24,
  ringClassName,
}: {
  marks: readonly AppMark[];
  size?: number;
  /** Match the containing surface, including its hover state. */
  ringClassName: string;
}) {
  return (
    <span aria-hidden="true" className="isolate flex shrink-0 items-center">
      {marks.map((mark, index) => (
        <AppMarkTile
          key={mark.name}
          mark={mark}
          size={size}
          index={index}
          ringClassName={ringClassName}
        />
      ))}
    </span>
  );
}

function AppMarkTile({
  mark,
  size,
  index,
  ringClassName,
}: {
  mark: AppMark;
  size: number;
  index: number;
  ringClassName: string;
}) {
  return (
    <span
      className={cn("rounded-full ring-2", ringClassName)}
      style={{
        marginLeft: index ? -size / 12 : 0,
        // Later tiles and their separating rings consistently sit above earlier tiles.
        zIndex: index,
      }}
    >
      <LogoTile name={mark.name} logo={mark.logo} size={size} shape="round" />
    </span>
  );
}
