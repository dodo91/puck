import {
  CodegenExpression,
  CodegenSlots,
  ComponentCodegenImport,
  Config,
  Content,
  Data,
  Fields,
} from "../../types";

export type GeneratedImport = {
  path: string;
  default?: string;
  named: { name: string; alias?: string }[];
};

export type GenerateJSXOptions<UserConfig extends Config = Config> = {
  config: UserConfig;
  data: Partial<Data>;
  baseDepth?: number;
  indentSize?: number;
};

export type GeneratedTree = {
  jsx: string;
  imports: GeneratedImport[];
};

export type GenerateComponentOptions<UserConfig extends Config = Config> =
  GenerateJSXOptions<UserConfig> & {
    componentName?: string;
  };

export type GeneratedComponent = GeneratedTree & {
  code: string;
  importStatements: string[];
};

type ImportRegistry = Map<
  string,
  {
    default?: string;
    named: Map<string, string | undefined>;
  }
>;

type RenderContext = {
  config: Config;
  indentSize: number;
  imports: ImportRegistry;
};

const DEFAULT_COMPONENT_NAME = "PuckComponent";

export function generateJSX<UserConfig extends Config = Config>({
  config,
  data,
  baseDepth = 0,
  indentSize = 2,
}: GenerateJSXOptions<UserConfig>): GeneratedTree {
  const resolvedData: Data = {
    root: data.root || {},
    content: data.content || [],
    zones: data.zones,
  } as Data;

  const registry: ImportRegistry = new Map();
  const context: RenderContext = {
    config,
    indentSize,
    imports: registry,
  };

  const body = renderContent(resolvedData.content, baseDepth + 1, context);
  const baseIndent = indent(baseDepth, indentSize);
  const hasBody = Boolean(body.trim());
  const jsx = hasBody
    ? `${baseIndent}<>\n${body}\n${baseIndent}</>`
    : `${baseIndent}<></>`;

  const imports = formatImports(registry);

  return {
    jsx,
    imports,
  };
}

export function generateComponent<UserConfig extends Config = Config>({
  componentName = DEFAULT_COMPONENT_NAME,
  baseDepth = 2,
  ...options
}: GenerateComponentOptions<UserConfig>): GeneratedComponent {
  const tree = generateJSX({ ...options, baseDepth });
  const importStatements = formatImportStatements(tree.imports);

  const component = `export function ${componentName}() {\n  return (\n${tree.jsx}\n  );\n}`;

  const code = importStatements.length
    ? `${importStatements.join("\n")}\n\n${component}`
    : component;

  return {
    ...tree,
    code,
    importStatements,
  };
}

export function formatImportStatements(imports: GeneratedImport[]): string[] {
  return imports
    .map((entry) => {
      const named = entry.named
        .map((specifier) =>
          specifier.alias
            ? `${specifier.name} as ${specifier.alias}`
            : specifier.name
        )
        .join(", ");

      const parts = [
        entry.default,
        named ? `{ ${named} }` : undefined,
      ].filter(Boolean);

      if (!parts.length) {
        return null;
      }

      return `import ${parts.join(", ")} from "${entry.path}";`;
    })
    .filter((statement): statement is string => Boolean(statement));
}

export function codegenExpression(code: string): CodegenExpression {
  const trimmed = code.includes("\n") ? code.replace(/\s+$/g, "") : code.trim();
  return {
    __codegen: trimmed,
  };
}

function renderContent(
  content: Content | undefined,
  depth: number,
  context: RenderContext
): string {
  if (!content || !content.length) {
    return "";
  }

  return content
    .map((item) => renderNode(item, depth, context))
    .filter((node): node is string => Boolean(node))
    .join("\n");
}

function renderNode(
  item: Content[number],
  depth: number,
  context: RenderContext
): string | null {
  const components = context.config.components as Record<string, any>;
  const componentConfig = components?.[item.type];

  if (!componentConfig) {
    throw new Error(`No component config found for "${item.type}".`);
  }

  if (componentConfig.codegen?.skip) {
    return null;
  }

  const props = { ...(item.props || {}) } as Record<string, unknown>;
  const slotNames = getSlotFieldNames(componentConfig.fields);

  const slotContent = slotNames.reduce<Record<string, Content>>(
    (acc, slotName) => {
      const value = props[slotName];
      acc[slotName] = Array.isArray(value) ? (value as Content) : [];
      delete props[slotName];
      return acc;
    },
    {}
  );

  delete props.id;
  delete (props as any).puck;

  const slotStrings: Record<string, string> = Object.keys(slotContent).reduce(
    (acc, key) => {
      acc[key] = renderContent(slotContent[key], 1, context);
      return acc;
    },
    {} as Record<string, string>
  );

  const slotExpressions = createSlotExpressions(slotStrings);
  const mappedProps =
    componentConfig.codegen?.mapProps?.({
      props: props as any,
      slots: slotExpressions,
    }) ?? props;

  const attributes = Object.entries(mappedProps || {})
    .map(([key, value]) =>
      formatAttribute(key, value, depth + 1, context.indentSize)
    )
    .filter((attr): attr is string => Boolean(attr));

  if (!componentConfig.codegen?.mapProps) {
    Object.entries(slotExpressions).forEach(([slotName, expression]) => {
      if (slotName === "children" || !expression) {
        return;
      }

      const attribute = formatAttribute(
        slotName,
        expression,
        depth + 1,
        context.indentSize
      );

      if (attribute) {
        attributes.push(attribute);
      }
    });
  }

  const componentName =
    componentConfig.codegen?.component || String(item.type);

  registerImport(context.imports, componentConfig.codegen?.import);

  const children =
    !componentConfig.codegen?.mapProps && slotStrings.children
      ? shiftIndent(slotStrings.children, 1, depth + 1, context.indentSize)
      : "";

  return buildElement({
    name: componentName,
    attributes,
    children,
    depth,
    indentSize: context.indentSize,
  });
}

function buildElement({
  name,
  attributes,
  children,
  depth,
  indentSize,
}: {
  name: string;
  attributes: string[];
  children: string;
  depth: number;
  indentSize: number;
}): string {
  const indentBase = indent(depth, indentSize);
  const attrBlock = attributes.length
    ? `\n${attributes
        .map((attribute) => `${indent(depth + 1, indentSize)}${attribute}`)
        .join("\n")}\n${indentBase}`
    : "";

  if (!children.trim()) {
    return `${indentBase}<${name}${attrBlock} />`;
  }

  return `${indentBase}<${name}${attrBlock}>\n${children}\n${indentBase}</${name}>`;
}

function getSlotFieldNames(fields?: Fields): string[] {
  if (!fields) {
    return [];
  }

  return Object.entries(fields)
    .filter(([, field]) => field?.type === "slot")
    .map(([key]) => key);
}

function indent(depth: number, indentSize: number): string {
  if (depth <= 0) {
    return "";
  }

  return " ".repeat(depth * indentSize);
}

function indentLines(code: string, depth: number, indentSize: number): string {
  if (!code) {
    return code;
  }

  const padding = indent(depth, indentSize);
  return code
    .split("\n")
    .map((line) => (line ? `${padding}${line}` : line))
    .join("\n");
}

function shiftIndent(
  code: string,
  fromDepth: number,
  toDepth: number,
  indentSize: number
): string {
  if (!code || !code.trim()) {
    return "";
  }

  if (toDepth <= fromDepth) {
    return code;
  }

  const addition = indent(toDepth - fromDepth, indentSize);
  return code
    .split("\n")
    .map((line) => (line ? `${addition}${line}` : line))
    .join("\n");
}

function registerImport(
  registry: ImportRegistry,
  importConfig?: ComponentCodegenImport | ComponentCodegenImport[]
) {
  if (!importConfig) {
    return;
  }

  const specs = Array.isArray(importConfig) ? importConfig : [importConfig];

  specs.forEach((spec) => {
    const next = registry.get(spec.path) || {
      named: new Map<string, string | undefined>(),
    };

    if ("default" in spec) {
      if (!next.default) {
        next.default = spec.default;
      }
    } else {
      next.named.set(spec.name, spec.alias);
    }

    registry.set(spec.path, next);
  });
}

function formatImports(registry: ImportRegistry): GeneratedImport[] {
  return Array.from(registry.entries())
    .map(([path, spec]) => ({
      path,
      default: spec.default,
      named: Array.from(spec.named.entries()).map(([name, alias]) => ({
        name,
        alias,
      })),
    }))
    .filter(
      (entry) => entry.default || (entry.named && entry.named.length > 0)
    )
    .map((entry) => ({
      ...entry,
      named: entry.named.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function createSlotExpressions(slotStrings: Record<string, string>): CodegenSlots {
  return Object.entries(slotStrings).reduce<CodegenSlots>((acc, [key, code]) => {
    const trimmed = code.trim();
    acc[key] = trimmed ? codegenExpression(wrapInFragment(code)) : null;
    return acc;
  }, {});
}

function wrapInFragment(code: string): string {
  const trimmed = code.trim();

  if (!trimmed) {
    return "";
  }

  if (!trimmed.includes("\n")) {
    return `<>${trimmed}</>`;
  }

  return `<>\n${code}\n</>`;
}

function isCodegenExpression(value: unknown): value is CodegenExpression {
  return Boolean(
    value && typeof value === "object" && "__codegen" in (value as any)
  );
}

function formatAttribute(
  key: string,
  value: unknown,
  depth: number,
  indentSize: number
): string | null {
  if (value === undefined) {
    return null;
  }

  if (isCodegenExpression(value)) {
    const code = value.__codegen;

    if (!code.includes("\n")) {
      return `${key}={${code}}`;
    }

    return `${key}={\n${indentLines(code, depth + 1, indentSize)}\n${indent(
      depth,
      indentSize
    )}}`;
  }

  if (value === null) {
    return `${key}={null}`;
  }

  if (typeof value === "string") {
    return `${key}=${JSON.stringify(value)}`;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${key}={${value}}`;
  }

  if (Array.isArray(value) || typeof value === "object") {
    return `${key}={${JSON.stringify(value)}}`;
  }

  return null;
}
