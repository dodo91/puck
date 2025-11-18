import type { ComponentData, Config } from "../../types";
import { UserGenerics } from "../../types";

const indent = (level: number) => "  ".repeat(level);

const isComponentData = (value: unknown): value is ComponentData => {
  if (!value || typeof value !== "object") return false;
  return "type" in value && "props" in value;
};

export type CodegenImport = {
  path: string;
  name?: string;
  default?: boolean;
};

export type CodegenComponentConfig<
  UserComponentData extends ComponentData = ComponentData
> = {
  as?: string;
  import?: CodegenImport;
  omitProps?: string[];
  preserveId?: boolean;
  transformProps?: (params: {
    component: UserComponentData;
    props: Record<string, any>;
  }) => Record<string, any>;
};

export type GenerateReactCodeOptions<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>
> = {
  config: UserConfig;
  data: G["UserData"];
  componentMap?: Record<string, CodegenComponentConfig<G["UserComponentData"]>>;
  componentName?: string;
  exportDefault?: boolean;
  includeImports?: boolean;
  includeReactImport?: boolean;
  omitIds?: boolean;
  wrapper?: {
    open: string;
    close: string;
  };
};

export type GenerateReactCodeResult = {
  code: string;
  imports: string[];
};

type ImportRecord = {
  defaultImport?: string;
  named: Array<{ name: string; alias?: string }>;
};

type InternalContext<
  UserConfig extends Config,
  G extends UserGenerics<UserConfig>
> = {
  componentMap?: GenerateReactCodeOptions<UserConfig, G>["componentMap"];
  imports: Map<string, ImportRecord>;
  omitIds: boolean;
};

export const generateReactCode = <
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>
>({
  data,
  componentMap,
  componentName = "GeneratedPage",
  exportDefault = false,
  includeImports = true,
  includeReactImport = false,
  omitIds = true,
  wrapper = { open: "<>", close: "</>" },
}: GenerateReactCodeOptions<UserConfig, G>): GenerateReactCodeResult => {
  const imports = new Map<string, ImportRecord>();
  const ctx: InternalContext<UserConfig, G> = {
    componentMap,
    imports,
    omitIds,
  };

  const rendered = (data.content ?? []).map((component) =>
    renderComponent(component as G["UserComponentData"], 2, ctx)
  );

  const bodyContent = rendered.length
    ? rendered.join("\n\n")
    : `${indent(3)}{/* No components in data */}`;

  const componentBody = [
    `export ${exportDefault ? "default " : ""}function ${componentName}() {`,
    `  return (`,
    `    ${wrapper.open}`,
    bodyContent,
    `    ${wrapper.close}`,
    `  );`,
    `}`,
  ];

  const importLines = includeImports
    ? buildImports(imports, includeReactImport)
    : includeReactImport
    ? ["import React from \"react\";"]
    : [];

  const code = importLines.length
    ? `${importLines.join("\n")}\n\n${componentBody.join("\n")}`
    : componentBody.join("\n");

  return { code, imports: importLines };
};

const buildImports = (imports: Map<string, ImportRecord>, includeReact?: boolean) => {
  const lines: string[] = [];

  if (includeReact) {
    lines.push("import React from \"react\";");
  }

  Array.from(imports.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([path, record]) => {
      const named = record.named
        .map((entry) =>
          entry.alias && entry.alias !== entry.name
            ? `${entry.name} as ${entry.alias}`
            : entry.name
        )
        .join(", ");

    const hasDefault = Boolean(record.defaultImport);
    const hasNamed = Boolean(named);

    if (!hasDefault && !hasNamed) return;

    if (hasDefault && hasNamed) {
      lines.push(
        `import ${record.defaultImport} from \"${path}\";`,
        `import { ${named} } from \"${path}\";`
      );

      return;
    }

    if (hasDefault) {
      lines.push(`import ${record.defaultImport} from \"${path}\";`);
      return;
    }

      lines.push(`import { ${named} } from \"${path}\";`);
    });

  return lines;
};

const formatPropValue = <
  UserConfig extends Config,
  G extends UserGenerics<UserConfig>
>(
  value: any,
  depth: number,
  ctx: InternalContext<UserConfig, G>
): { type: "string" | "expression"; value: string } => {
  if (value === undefined) {
    return { type: "expression", value: "undefined" };
  }

  if (typeof value === "string") {
    return { type: "string", value: JSON.stringify(value) };
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return { type: "expression", value: String(value) };
  }

  if (value === null) {
    return { type: "expression", value: "null" };
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return { type: "expression", value: "[]" };
    }

    const inner = value
      .map((item) => {
        if (isComponentData(item)) {
          return renderComponent(item, depth + 1, ctx);
        }

        const formatted = formatPropValue(item, depth + 1, ctx);
        return `${indent(depth + 1)}${formatted.value}`;
      })
      .join(",\n");

    return {
      type: "expression",
      value: `[\n${inner}\n${indent(depth)}]`,
    };
  }

  if (isComponentData(value)) {
    const rendered = renderComponent(value, depth + 2, ctx);
    return {
      type: "expression",
      value: `(\n${rendered}\n${indent(depth + 1)})`,
    };
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);

    if (!entries.length) {
      return { type: "expression", value: "{}" };
    }

    const lines = entries.map(([key, val]) => {
      const formatted = formatPropValue(val, depth + 1, ctx);
      return `${indent(depth + 1)}${key}: ${formatted.value}`;
    });

    return {
      type: "expression",
      value: `{\n${lines.join(",\n")}\n${indent(depth)}}`,
    };
  }

  return { type: "expression", value: "undefined" };
};

const formatChildren = <
  UserConfig extends Config,
  G extends UserGenerics<UserConfig>
>(
  value: any,
  depth: number,
  ctx: InternalContext<UserConfig, G>
): string | null => {
  if (value === undefined || value === null) return null;

  if (Array.isArray(value)) {
    if (!value.length) return null;

    return value
      .map((child) => {
        if (isComponentData(child)) {
          return renderComponent(child, depth, ctx);
        }

        const formatted = formatPropValue(child, depth, ctx);
        return `${indent(depth)}{${formatted.value}}`;
      })
      .join("\n");
  }

  if (isComponentData(value)) {
    return renderComponent(value, depth, ctx);
  }

  const formatted = formatPropValue(value, depth, ctx);
  return `${indent(depth)}{${formatted.value}}`;
};

const renderComponent = <
  UserConfig extends Config,
  G extends UserGenerics<UserConfig>
>(
  component: G["UserComponentData"],
  depth: number,
  ctx: InternalContext<UserConfig, G>
): string => {
  const mapEntry = ctx.componentMap?.[component.type];
  const componentName = mapEntry?.as ?? component.type;

  if (mapEntry?.import) {
    registerImport(componentName, mapEntry.import, ctx);
  }

  const omitId = ctx.omitIds && !mapEntry?.preserveId;
  const cleanedProps = { ...component.props } as Record<string, any>;
  delete cleanedProps.puck;
  delete cleanedProps.editMode;
  if (omitId) {
    delete cleanedProps.id;
  }

  if (mapEntry?.omitProps?.length) {
    mapEntry.omitProps.forEach((prop) => {
      delete cleanedProps[prop];
    });
  }

  const transformedProps = mapEntry?.transformProps
    ? mapEntry.transformProps({
        component,
        props: cleanedProps,
      })
    : cleanedProps;

  const { children, ...props } = transformedProps;
  const propEntries = Object.entries(props).filter(
    ([, value]) => value !== undefined
  );

  const propLines = propEntries.map(([key, value]) => {
    const formatted = formatPropValue(value, depth, ctx);
    const propIndent = indent(depth);

    if (formatted.type === "string") {
      return `${propIndent}${key}=${formatted.value}`;
    }

    return `${propIndent}${key}={${formatted.value}}`;
  });

  const childrenContent = formatChildren(children, depth + 1, ctx);
  const hasChildren = Boolean(childrenContent);

  if (!propLines.length && !hasChildren) {
    return `${indent(depth)}<${componentName} />`;
  }

  if (!hasChildren) {
    return `${indent(depth)}<${componentName}\n${propLines.join(
      "\n"
    )}\n${indent(depth)} />`;
  }

  const propsString = propLines.length
    ? `\n${propLines.join("\n")}\n${indent(depth)}`
    : "";

  const childrenString = childrenContent
    ? `\n${childrenContent}\n${indent(depth)}`
    : "";

  return `${indent(depth)}<${componentName}${propsString}>${childrenString}</${componentName}>`;
};

const registerImport = <
  UserConfig extends Config,
  G extends UserGenerics<UserConfig>
>(
  localName: string,
  importConfig: CodegenImport,
  ctx: InternalContext<UserConfig, G>
) => {
  const record = ctx.imports.get(importConfig.path) ?? { named: [] };

  if (importConfig.default) {
    record.defaultImport = localName;
    ctx.imports.set(importConfig.path, record);
    return;
  }

  const importName = importConfig.name ?? localName;

  if (
    !record.named.some(
      (entry) => entry.name === importName && entry.alias === localName
    )
  ) {
    record.named.push(
      localName === importName
        ? { name: importName }
        : { name: importName, alias: localName }
    );
  }

  ctx.imports.set(importConfig.path, record);
};
