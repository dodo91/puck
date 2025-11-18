import { generateReactComponent } from "../generate-react";
import { Config } from "../../../types";

const config: Config = {
  components: {
    Button: {
      render: () => null,
      fields: {
        label: { type: "text" },
      },
    },
    Section: {
      render: () => null,
      fields: {
        title: { type: "text" },
        content: { type: "slot" },
      },
    },
  },
};

const data = {
  root: { props: {} },
  content: [
    {
      type: "Section",
      props: {
        id: "Section-1",
        title: "Welcome",
        content: [
          {
            type: "Button",
            props: {
              id: "Button-1",
              label: "Get started",
            },
          },
        ],
      },
    },
  ],
};

describe("generateReactComponent", () => {
  it("creates a React component tree", () => {
    const result = generateReactComponent({
      config,
      data,
      componentName: "LandingPage",
      components: {
        Section: {
          as: "Card",
          import: { path: "antd", import: "Card" },
          slotProps: { content: "children" },
        },
        Button: {
          as: "Button",
          import: { path: "antd", import: "Button" },
          mapProps: ({ label }) => ({ children: label }),
        },
      },
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import React from "react";
      import { Button, Card } from "antd";
      export function LandingPage() {
        return (<><Card title="Welcome"><Button key="Button-1">Get started</Button></Card></>);
      }"
    `);
  });

  it("supports disabling the React import and default imports", () => {
    const result = generateReactComponent({
      config,
      data,
      componentName: "MarketingPage",
      includeIds: true,
      reactImport: false,
      components: {
        Section: {
          as: "MarketingSection",
          import: { path: "@/components/Section", default: "MarketingSection" },
          slotProps: { content: "children" },
        },
        Button: {
          as: "PrimaryButton",
          import: { path: "@/components/Button", default: "PrimaryButton" },
        },
      },
    });

    expect(result.code).toMatchInlineSnapshot(`
      "import PrimaryButton from "@/components/Button";
      import MarketingSection from "@/components/Section";
      export function MarketingPage() {
        return (<><MarketingSection id="Section-1" title="Welcome"><PrimaryButton key="Button-1" id="Button-1" label="Get started" /></MarketingSection></>);
      }"
    `);
  });
});
