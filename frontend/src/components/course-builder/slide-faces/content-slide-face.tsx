"use client";

import { useRef, useState } from "react";

import type { ContentSlideLayout, SlideConfig } from "@/lib/course-types";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { cn } from "@/lib/utils";
import type { SlideFaceProps } from "./index";

// Local title state updates every keystroke for instant feedback; the network
// PATCH (routed through onTitleChange/onConfigChange, which course-builder.tsx
// wires to the updateSlide Server Action) is debounced so typing doesn't
// fire a request per character. The canvas mounts this component with
// key={slide.id} (see slide-canvas.tsx), so switching slides fully remounts
// it — local state initializes fresh from the new slide's props and any
// pending debounced call from the previous slide is cancelled by the hook's
// unmount cleanup rather than firing stale.
const CHANGE_DEBOUNCE_MS = 500;

const FIELD_CLASSES =
  "w-full resize-none border-none bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground/50 focus:rounded focus:outline-none focus:ring-1 focus:ring-primary/40";

export function ContentSlideFace({ slide, interactive, onTitleChange, onConfigChange }: SlideFaceProps) {
  const layout: ContentSlideLayout = slide.config.layout ?? "title-body";

  const [localTitle, setLocalTitle] = useState(slide.title);
  const title = interactive ? localTitle : slide.title;

  const debouncedTitleChange = useDebouncedCallback((value: string) => {
    onTitleChange?.(value);
  }, CHANGE_DEBOUNCE_MS);
  const debouncedConfigChange = useDebouncedCallback((value: Partial<SlideConfig>) => {
    onConfigChange?.(value);
  }, CHANGE_DEBOUNCE_MS);

  function handleTitleChange(value: string) {
    setLocalTitle(value);
    debouncedTitleChange(value);
  }

  const titleNode = interactive ? (
    <input
      value={title}
      onChange={(e) => handleTitleChange(e.target.value)}
      placeholder="Click to add title"
      className={cn(FIELD_CLASSES, "text-4xl font-bold")}
    />
  ) : (
    <div className={cn(FIELD_CLASSES, "text-4xl font-bold pointer-events-none")}>
      {title || <span className="text-muted-foreground/50">Click to add title</span>}
    </div>
  );

  // "two-column" renders two genuinely separate text boxes side by side
  // (config.body / config.body2), not one field CSS-split into columns —
  // CSS `columns` only wraps text into a second column once it overflows
  // the container's height, so a short body would look identical to
  // "title-body" and the layout picker would appear to do nothing.
  const bodyNodes =
    layout === "two-column" ? (
      <div className="flex h-full gap-8">
        <EditableBody
          value={slide.config.body}
          interactive={interactive}
          onCommit={(body) => debouncedConfigChange({ body })}
          className="flex-1"
        />
        <EditableBody
          value={slide.config.body2}
          interactive={interactive}
          onCommit={(body2) => debouncedConfigChange({ body2 })}
          className="flex-1"
        />
      </div>
    ) : (
      <EditableBody
        value={slide.config.body}
        interactive={interactive}
        onCommit={(body) => debouncedConfigChange({ body })}
      />
    );

  if (layout === "title-only") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-white px-16 py-12 text-center text-foreground">
        {titleNode}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-white px-16 py-12 text-foreground">
      {titleNode}
      <div className="mt-8 min-h-0 flex-1">{bodyNodes}</div>
    </div>
  );
}

// One plain-text placeholder/text-box. Uncontrolled by design when
// interactive: React sets the initial text once (contentEditable's children)
// and never re-feeds it while editing, so typing never fights React's
// reconciliation or jumps the cursor — the debounced onCommit is the only
// way data flows back out.
function EditableBody({
  value,
  interactive,
  onCommit,
  className,
}: {
  value: string | undefined;
  interactive: boolean;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const body = value ?? "";
  const ref = useRef<HTMLDivElement>(null);

  function handleInput() {
    onCommit(ref.current?.textContent ?? "");
  }
  // Plain-text body only (no rich formatting this phase) — strip any HTML a
  // paste would otherwise bring into the contentEditable div.
  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  }

  const classes = cn(
    FIELD_CLASSES,
    "h-full overflow-hidden text-lg leading-relaxed whitespace-pre-wrap",
    !interactive && "pointer-events-none",
    interactive && "empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]",
    className,
  );

  if (!interactive) {
    return (
      <div className={classes}>{body || <span className="text-muted-foreground/50">Click to add text</span>}</div>
    );
  }

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onPaste={handlePaste}
      data-placeholder="Click to add text"
      className={classes}
    >
      {body}
    </div>
  );
}
