import { DefaultComponentProps } from "./Props";

export type CodegenSlots = Record<string, CodegenExpression | null>;

export type ComponentCodegenImport =
  | {
      path: string;
      name: string;
      alias?: string;
    }
  | {
    path: string;
    default: string;
  };

export type ComponentCodegenMapProps<
  Props extends DefaultComponentProps = DefaultComponentProps
> = (params: { props: Props; slots: CodegenSlots }) =>
  | Record<string, unknown>
  | undefined
  | void;

export type ComponentCodegenConfig<
  Props extends DefaultComponentProps = DefaultComponentProps
> = {
  component?: string;
  import?: ComponentCodegenImport | ComponentCodegenImport[];
  mapProps?: ComponentCodegenMapProps<Props>;
  skip?: boolean;
};

export type CodegenExpression = {
  __codegen: string;
};
