import type { Config } from "../../../types";
import type { Data } from "../../../types/Data";
import { generateReactCode } from "../generate-react-code";

type Components = {
  HeadingBlock: {
    title: string;
    children?: any;
  };
  Stack: {
    items: any[];
    gap?: number;
  };
};

type TestData = Data<Components>;

const config: Config<Components> = {
  components: {
    HeadingBlock: {
      render: () => null,
      fields: {
        title: { type: "text" },
        children: { type: "slot" },
      },
    },
    Stack: {
      render: () => null,
      fields: {
        items: { type: "slot" },
        gap: { type: "number" },
      },
    },
  },
};

const data: TestData = {
  root: { props: {} },
  content: [
    {
      type: "Stack",
      props: {
        id: "Stack-1",
        gap: 24,
        items: [
          {
            type: "HeadingBlock",
            props: {
              id: "HeadingBlock-1",
              title: "Hello world",
            },
          },
          {
            type: "HeadingBlock",
            props: {
              id: "HeadingBlock-2",
              title: "Second block",
            },
          },
        ],
      },
    },
  ],
};

describe("generateReactCode", () => {
  it("creates a simple React component without imports", () => {
    const result = generateReactCode({
      config,
      data,
      includeImports: false,
      componentName: "LandingPage",
    });

    expect(result.code).toContain("export function LandingPage()");
    expect(result.code).toContain("<Stack");
    expect(result.imports).toEqual([]);
  });

  it("maps components with imports and transformProps", () => {
    const result = generateReactCode({
      config,
      data,
      componentName: "AntdPage",
      componentMap: {
        HeadingBlock: {
          as: "AntHeading",
          import: { path: "@/components/AntHeading", default: true },
          transformProps: ({ props }) => ({
            level: 2,
            children: props.title,
          }),
        },
        Stack: {
          as: "Row",
          import: { path: "antd", name: "Row" },
          transformProps: ({ props }) => ({
            gutter: props.gap,
            children: props.items,
          }),
        },
      },
    });

    expect(result.code).toContain("function AntdPage");
    expect(result.code).toContain("<Row");
    expect(result.code).toContain("<AntHeading");
    expect(result.imports).toContain('import AntHeading from "@/components/AntHeading";');
    expect(result.imports).toContain('import { Row } from "antd";');
  });
});
