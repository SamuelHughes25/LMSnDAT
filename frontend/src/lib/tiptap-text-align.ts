import { Extension } from "@tiptap/core";

// A small, self-written extension — unlike tiptap-font-size.ts/
// tiptap-text-color.ts (thin re-exports of extensions @tiptap/extension-text-style
// already bundles), there is no installed `@tiptap/extension-text-align`
// package in this project and this sandbox has no working package manager
// to add one. This mirrors that official extension's well-known shape
// closely enough to be a drop-in for this app's own needs: a `textAlign`
// attribute on `paragraph` nodes (the only block type slide bodies/titles
// ever produce — see content-slide-face.tsx's StarterKit config, which
// already disables headings/blockquotes/etc.), rendered as an inline
// `text-align` style, with `setTextAlign`/`unsetTextAlign` commands matching
// the naming convention the real extension (and this app's own
// setFontSize/setColor pair) use.
export type TextAlignValue = "left" | "center" | "right" | "justify";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textAlign: {
      setTextAlign: (align: TextAlignValue) => ReturnType;
      unsetTextAlign: () => ReturnType;
    };
  }
}

export const TextAlign = Extension.create({
  name: "textAlign",

  addOptions() {
    return { types: ["paragraph"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => element.style.textAlign || null,
            renderHTML: (attributes) => {
              if (!attributes.textAlign) return {};
              return { style: `text-align: ${attributes.textAlign}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextAlign:
        (align: TextAlignValue) =>
        ({ commands }) => {
          return this.options.types
            .map((type: string) => commands.updateAttributes(type, { textAlign: align }))
            .every(Boolean);
        },
      unsetTextAlign:
        () =>
        ({ commands }) => {
          return this.options.types
            .map((type: string) => commands.resetAttributes(type, "textAlign"))
            .every(Boolean);
        },
    };
  },
});
