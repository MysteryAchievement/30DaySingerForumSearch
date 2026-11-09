import sanitizeHtml from "sanitize-html";

export function sanitizeForumHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "hr",
      "span",
      "div",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "del",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "img",
      "code",
      "pre",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td"
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      span: ["style"],
      div: ["style"],
      "*": ["class"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "nofollow noopener noreferrer",
        target: "_blank"
      })
    },
    exclusiveFilter: (frame) =>
      frame.tag === "img" &&
      !/^https?:\/\//i.test(frame.attribs.src ?? "")
  });
}
