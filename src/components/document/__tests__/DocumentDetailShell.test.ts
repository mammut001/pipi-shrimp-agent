import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentDetailShell } from "../DocumentDetailShell";

describe("DocumentDetailShell", () => {
  it("renders header with layout toggle gutter class pr-20", () => {
    const markup = renderToStaticMarkup(
      createElement(
        DocumentDetailShell,
        {
          title: "Test Document",
          subtitle: "Test Subtitle",
          headerActions: createElement("button", null, "Action"),
        },
        createElement("div", null, "Content"),
      ),
    );

    expect(markup).toContain("pr-20");
    expect(markup).toContain("Test Document");
    expect(markup).toContain("Test Subtitle");
    expect(markup).toContain("Action");
  });
});
