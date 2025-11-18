import type { Config, Data } from "../../../types";
import {
  codegenExpression,
  generateComponent,
  generateJSX,
} from "../index";

describe("code generation", () => {
  const config: Config<any> = {
    components: {
      Heading: {
        fields: {
          title: { type: "text" },
        },
        render: () => null,
        codegen: {
          component: "Typography.Title",
          import: { path: "antd", name: "Typography" },
        },
      },
      Button: {
        fields: {
          label: { type: "text" },
        },
        render: () => null,
        codegen: {
          component: "Button",
          import: { path: "antd", name: "Button" },
          mapProps: ({ props }) => ({
            type: "primary",
            children: props.label,
          }),
        },
      },
      Callout: {
        fields: {
          headline: { type: "text" },
          children: { type: "slot" },
          actions: { type: "slot" },
        },
        render: () => null,
        codegen: {
          component: "Card",
          import: { path: "antd", name: "Card" },
          mapProps: ({ props, slots }) => ({
            title: props.headline,
            children: slots.children,
            extra: slots.actions,
            icon: codegenExpression("<Sparkles />"),
          }),
        },
      },
    },
  };

  it("creates a component file with imports", () => {
    const data: Partial<Data> = {
      content: [
        {
          type: "Heading",
          props: {
            title: "Docs",
          },
        },
      ],
    };

    const result = generateComponent({ config, data });

    expect(result.importStatements).toEqual([
      'import { Typography } from "antd";',
    ]);
    expect(result.code).toContain("export function PuckComponent()");
    expect(result.code).toContain("<Typography.Title");
    expect(result.code).toContain('title="Docs"');
  });

  it("handles slots and mapped props", () => {
    const data: Partial<Data> = {
      content: [
        {
          type: "Callout",
          props: {
            headline: "Bring your own components",
            children: [
              {
                type: "Heading",
                props: { title: "Headline" },
              },
            ],
            actions: [
              {
                type: "Button",
                props: { label: "Read more" },
              },
            ],
          },
        },
      ],
    };

    const tree = generateJSX({ config, data });

    expect(tree.imports).toEqual([
      {
        path: "antd",
        default: undefined,
        named: [
          { name: "Button" },
          { name: "Card" },
          { name: "Typography" },
        ],
      },
    ]);

    expect(tree.jsx).toContain("<Card");
    expect(tree.jsx).toContain("title=\"Bring your own components\"");
    expect(tree.jsx).toContain("extra={");
    expect(tree.jsx).toContain("children={");
    expect(tree.jsx).toContain("<Sparkles />");
  });
});
