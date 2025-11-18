import generate from "@babel/generator";
import * as t from "@babel/types";
import {
  ComponentData,
  Config,
  Content,
  Field,
  Fields,
  UserGenerics,
} from "../../types";

type NamedImportSpec = {
  path: string;
  import: string;
  alias?: string;
};

type DefaultImportSpec = {
  path: string;
  default: string;
};

export type CodegenImport = NamedImportSpec | DefaultImportSpec;

export type CodegenComponentTransform<Props> = {
  as?: string;
  import?: CodegenImport | CodegenImport[];
  mapProps?: (props: Props) => Record<string, any>;
  slotProps?: Partial<Record<keyof Props, string>>;
};

export type GenerateReactComponentOptions<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>,
> = {
  config: UserConfig;
  data: G["UserData"];
  componentName?: string;
  components?: Partial<{
    [K in keyof G["UserProps"]]: CodegenComponentTransform<G["UserProps"][K]>;
  }>;
  includeIds?: boolean;
  reactImport?: boolean;
};

export type GenerateReactComponentResult = {
  code: string;
};

type ImportBucket = {
  named: Map<string, string | undefined>;
  defaultName?: string;
};

const isDefaultImport = (spec: CodegenImport): spec is DefaultImportSpec =>
  (spec as DefaultImportSpec).default !== undefined;

const createObjectKey = (key: string) =>
  t.isValidIdentifier(key) ? t.identifier(key) : t.stringLiteral(key);

export function generateReactComponent<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>,
>({
  config,
  data,
  componentName = "GeneratedPage",
  components = {},
  includeIds = false,
  reactImport = true,
}: GenerateReactComponentOptions<UserConfig, G>): GenerateReactComponentResult {
  const importBuckets = new Map<string, ImportBucket>();

  const registerImport = (spec?: CodegenImport | CodegenImport[]) => {
    if (!spec) return;

    const specs = Array.isArray(spec) ? spec : [spec];

    specs.forEach((entry) => {
      if (isDefaultImport(entry)) {
        const bucket = importBuckets.get(entry.path) ?? {
          named: new Map(),
        };

        if (bucket.defaultName && bucket.defaultName !== entry.default) {
          throw new Error(
            `Multiple default imports declared for "${entry.path}". Received "${bucket.defaultName}" and "${entry.default}".`
          );
        }

        bucket.defaultName = entry.default;
        importBuckets.set(entry.path, bucket);
        return;
      }

      const bucket = importBuckets.get(entry.path) ?? {
        named: new Map(),
      };

      const existingAlias = bucket.named.get(entry.import);
      if (existingAlias && existingAlias !== entry.alias) {
        throw new Error(
          `Conflicting aliases declared for "${entry.import}" from "${entry.path}".`
        );
      }

      bucket.named.set(entry.import, entry.alias);
      importBuckets.set(entry.path, bucket);
    });
  };

  const getComponentTransform = (
    componentName: string
  ): CodegenComponentTransform<any> | undefined =>
    components[componentName as keyof typeof components] as
      | CodegenComponentTransform<any>
      | undefined;

  const createSlotChildren = (content?: Content): t.JSXChild[] => {
    if (!content || !Array.isArray(content) || content.length === 0) {
      return [];
    }

    return content.map((child) => createComponent(child, true));
  };

  const createArrayExpression = (
    values: any[],
    fields: Fields | undefined
  ): t.ArrayExpression => {
    const elements = (values || []).map((item) => {
      if (item === undefined) {
        return t.nullLiteral();
      }

      if (item && typeof item === "object" && !Array.isArray(item)) {
        return createObjectExpression(item, fields);
      }

      return t.valueToNode(item);
    });

    return t.arrayExpression(elements as t.Expression[]);
  };

  const createObjectExpression = (
    value: Record<string, any>,
    fields: Fields | undefined
  ): t.ObjectExpression => {
    const properties = Object.entries(value || {})
      .filter(([, propValue]) => propValue !== undefined)
      .map(([key, propValue]) => {
        const field = fields?.[key];
        const node = createFieldValueNode(propValue, field);
        if (!node) {
          return null;
        }

        return t.objectProperty(createObjectKey(key), node);
      })
      .filter((prop): prop is t.ObjectProperty => Boolean(prop));

    return t.objectExpression(properties);
  };

  const createFieldValueNode = (
    value: any,
    field?: Field
  ): t.Expression | t.StringLiteral | null => {
    if (value === undefined) {
      return null;
    }

    if (!field) {
      return t.valueToNode(value);
    }

    if (field.type === "slot") {
      const slotChildren = createSlotChildren(value as Content);

      if (slotChildren.length === 0) {
        return t.nullLiteral();
      }

      if (slotChildren.length === 1) {
        return slotChildren[0] as t.JSXElement;
      }

      return t.jsxFragment(
        t.jsxOpeningFragment(),
        t.jsxClosingFragment(),
        slotChildren
      );
    }

    if (field.type === "array") {
      const fields = field.arrayFields as Fields | undefined;
      return createArrayExpression(value ?? [], fields);
    }

    if (field.type === "object") {
      const fields = field.objectFields as Fields | undefined;
      return createObjectExpression(value ?? {}, fields);
    }

    return t.valueToNode(value);
  };

  const createAttributes = (
    component: ComponentData,
    componentFields: Fields | undefined,
    transform?: CodegenComponentTransform<any>
  ) => {
    const attributes: t.JSXAttribute[] = [];
    const children: t.JSXChild[] = [];
    const propEntries = Object.entries(component.props || {});

    const pushChild = (node: t.Expression | t.StringLiteral) => {
      if (t.isNullLiteral(node)) {
        return;
      }

      if (t.isStringLiteral(node)) {
        children.push(t.jsxText(node.value));
        return;
      }

      if (t.isJSXElement(node) || t.isJSXFragment(node)) {
        children.push(node);
        return;
      }

      children.push(t.jsxExpressionContainer(node));
    };

    propEntries.forEach(([name, value]) => {
      if (!includeIds && name === "id") {
        return;
      }

      const field = componentFields?.[name];
      const mappedName =
        (field?.type === "slot" && transform?.slotProps?.[name]) || name;

      if (mappedName === "children") {
        if (field?.type === "slot") {
          children.push(...createSlotChildren(value as Content));
          return;
        }

        const node = createFieldValueNode(value, field);
        if (!node) {
          return;
        }

        pushChild(node);
        return;
      }

      if (field?.type === "slot") {
        const slotChildren = createSlotChildren(value as Content);

        if (
          (mappedName === "children" || name === "children") &&
          slotChildren.length
        ) {
          children.push(...slotChildren);
          return;
        }

        const slotExpression = createFieldValueNode(value, field);
        if (!slotExpression) {
          return;
        }

        attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier(mappedName),
            t.jsxExpressionContainer(slotExpression)
          )
        );
        return;
      }

      const node = createFieldValueNode(value, field);

      if (!node) {
        return;
      }

      if (t.isStringLiteral(node)) {
        attributes.push(t.jsxAttribute(t.jsxIdentifier(mappedName), node));
        return;
      }

      attributes.push(
        t.jsxAttribute(t.jsxIdentifier(mappedName), t.jsxExpressionContainer(node))
      );
    });

    return { attributes, children };
  };

  const createComponent = (
    component: ComponentData,
    addKey: boolean = false
  ): t.JSXElement => {
    const componentConfig = config.components?.[component.type];

    if (!componentConfig) {
      throw new Error(
        `Component "${component.type}" is not defined in the provided config.`
      );
    }

    const transform = getComponentTransform(component.type);
    const componentIdentifier = transform?.as || component.type;

    registerImport(transform?.import);

    const props = transform?.mapProps
      ? transform.mapProps(component.props || {})
      : component.props || {};

    const nextComponent: ComponentData = {
      ...component,
      props,
    };

    const { attributes, children } = createAttributes(
      nextComponent,
      componentConfig.fields,
      transform
    );

    if (addKey && component.props?.id) {
      const hasKey = attributes.some(
        (attr) => t.isJSXIdentifier(attr.name) && attr.name.name === "key"
      );

      if (!hasKey) {
        attributes.unshift(
          t.jsxAttribute(t.jsxIdentifier("key"), t.stringLiteral(component.props.id))
        );
      }
    }

    const elementChildren: t.JSXChild[] = children;

    const opening = t.jsxOpeningElement(
      t.jsxIdentifier(componentIdentifier),
      attributes,
      elementChildren.length === 0
    );

    const closing =
      elementChildren.length === 0
        ? null
        : t.jsxClosingElement(t.jsxIdentifier(componentIdentifier));

    return t.jsxElement(opening, closing, elementChildren, elementChildren.length === 0);
  };

  const rootChildren = (data.content || []).map((component) =>
    createComponent(component as ComponentData)
  );

  const fragment = t.jsxFragment(
    t.jsxOpeningFragment(),
    t.jsxClosingFragment(),
    rootChildren
  );

  const statements: t.Statement[] = [];

  if (reactImport) {
    statements.push(
      t.importDeclaration(
        [t.importDefaultSpecifier(t.identifier("React"))],
        t.stringLiteral("react")
      )
    );
  }

  Array.from(importBuckets.entries())
    .sort(([pathA], [pathB]) => pathA.localeCompare(pathB))
    .forEach(([path, bucket]) => {
      const namedImports = Array.from(bucket.named.entries()).sort((a, b) =>
        a[0].localeCompare(b[0])
      );

      const specifiers: Array<t.ImportSpecifier | t.ImportDefaultSpecifier> = [];

      if (bucket.defaultName) {
        specifiers.push(
          t.importDefaultSpecifier(t.identifier(bucket.defaultName))
        );
      }

      namedImports.forEach(([importName, alias]) => {
        specifiers.push(
          t.importSpecifier(
            t.identifier(alias || importName),
            t.identifier(importName)
          )
        );
      });

      statements.push(t.importDeclaration(specifiers, t.stringLiteral(path)));
    });

  const returnStatement = t.returnStatement(t.parenthesizedExpression(fragment));

  const componentDeclaration = t.exportNamedDeclaration(
    t.functionDeclaration(
      t.identifier(componentName),
      [],
      t.blockStatement([returnStatement])
    )
  );

  statements.push(componentDeclaration);

  const file = t.file(t.program(statements));

  return {
    code: generate(file, {
      retainLines: false,
      compact: false,
      jsescOption: { minimal: true },
    }).code,
  };
}
