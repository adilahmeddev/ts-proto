import { code, def, Code, joinCode } from "ts-poet";
import { EnumDescriptorProto, EnumValueDescriptorProto } from "ts-proto-descriptors";
import { maybeAddComment } from "./utils";
import { uncapitalize, camelToSnake } from "./case";
import SourceInfo, { Fields } from "./sourceInfo";
import { Context } from "./context";

type UnrecognizedEnum = { present: false } | { present: true; name: string; originalName: string };

// Output the `enum { Foo, A = 0, B = 1 }`
export function generateEnum(
  ctx: Context,
  fullName: string,
  enumDesc: EnumDescriptorProto,
  sourceInfo: SourceInfo,
): Code {
  const { options } = ctx;
  const chunks: Code[] = [];
  let unrecognizedEnum: UnrecognizedEnum = { present: false };

  // Check if this is a nested enum and if we should use namespaces
  const isNestedEnum = fullName.includes("_");
  const useNamespace = options.nestedEnumsAsNamespaces && isNestedEnum;

  let actualEnumName = fullName;
  let namespaceName: string | undefined;

  if (useNamespace) {
    const lastUnderscore = fullName.lastIndexOf("_");
    namespaceName = fullName.substring(0, lastUnderscore);
    actualEnumName = fullName.substring(lastUnderscore + 1);
  }

  maybeAddComment(options, sourceInfo, chunks, enumDesc.options?.deprecated);

  if (useNamespace) {
    // Create namespace and enum inside it
    // Use regular namespace for enumsAsLiterals because declare namespace can't have const initializers
    if (options.enumsAsLiterals) {
      chunks.push(code`export namespace ${def(namespaceName!)} {`);
    } else {
      chunks.push(code`export declare namespace ${def(namespaceName!)} {`);
    }
  }

  if (options.enumsAsLiterals) {
    if (useNamespace) {
      chunks.push(code`export const ${def(actualEnumName)} = {`);
    } else {
      chunks.push(code`export const ${def(fullName)} = {`);
    }
  } else {
    if (useNamespace) {
      chunks.push(code`export ${options.constEnums ? "const " : ""}enum ${def(actualEnumName)} {`);
    } else {
      chunks.push(code`export ${options.constEnums ? "const " : ""}enum ${def(fullName)} {`);
    }
  }

  const delimiter = options.enumsAsLiterals ? ":" : "=";

  enumDesc.value.forEach((valueDesc, index) => {
    const info = sourceInfo.lookup(Fields.enum.value, index);
    const valueName = getValueName(ctx, fullName, valueDesc);
    const memberName = getMemberName(ctx, enumDesc, valueDesc);
    if (valueDesc.number === options.unrecognizedEnumValue) {
      unrecognizedEnum = { present: true, name: memberName, originalName: valueName };
    }
    maybeAddComment(options, info, chunks, valueDesc.options?.deprecated, `${memberName} - `);
    chunks.push(
      code`${memberName} ${delimiter} ${options.stringEnums ? `"${valueName}"` : valueDesc.number.toString()},`,
    );
  });

  if (options.unrecognizedEnum && !unrecognizedEnum.present) {
    chunks.push(code`
      ${options.unrecognizedEnumName} ${delimiter} ${
        options.stringEnums ? `"${options.unrecognizedEnumName}"` : options.unrecognizedEnumValue.toString()
      },`);
  }

  if (options.enumsAsLiterals) {
    chunks.push(code`} as const`);
    chunks.push(code`\n`);
    if (useNamespace) {
      chunks.push(
        code`export type ${def(actualEnumName)} = typeof ${def(actualEnumName)}[keyof typeof ${def(actualEnumName)}]`,
      );
    } else {
      chunks.push(code`export type ${def(fullName)} = typeof ${def(fullName)}[keyof typeof ${def(fullName)}]`);
    }
    chunks.push(code`\n`);
    if (useNamespace) {
      chunks.push(code`export namespace ${def(actualEnumName)} {`);
    } else {
      chunks.push(code`export namespace ${def(fullName)} {`);
    }

    enumDesc.value.forEach((valueDesc) => {
      const memberName = getMemberName(ctx, enumDesc, valueDesc);
      if (useNamespace) {
        chunks.push(code`export type ${memberName} = typeof ${def(actualEnumName)}.${memberName};`);
      } else {
        chunks.push(code`export type ${memberName} = typeof ${def(fullName)}.${memberName};`);
      }
    });

    if (options.unrecognizedEnum && !unrecognizedEnum.present) {
      if (useNamespace) {
        chunks.push(
          code`export type ${options.unrecognizedEnumName} = typeof ${def(actualEnumName)}.${options.unrecognizedEnumName};`,
        );
      } else {
        chunks.push(
          code`export type ${options.unrecognizedEnumName} = typeof ${def(fullName)}.${options.unrecognizedEnumName};`,
        );
      }
    }

    chunks.push(code`}`);
  } else {
    chunks.push(code`}`);
  }

  // Close the namespace if we opened one
  if (useNamespace) {
    chunks.push(code`}`);
  }

  if (
    options.outputJsonMethods === true ||
    options.outputJsonMethods === "from-only" ||
    (options.stringEnums && options.outputEncodeMethods)
  ) {
    chunks.push(code`\n`);
    chunks.push(
      generateEnumFromJson(
        ctx,
        fullName,
        enumDesc,
        unrecognizedEnum,
        useNamespace ? namespaceName : undefined,
        useNamespace ? actualEnumName : undefined,
      ),
    );
  }
  if (options.outputJsonMethods === true || options.outputJsonMethods === "to-only") {
    chunks.push(code`\n`);
    chunks.push(
      generateEnumToJson(
        ctx,
        fullName,
        enumDesc,
        unrecognizedEnum,
        useNamespace ? namespaceName : undefined,
        useNamespace ? actualEnumName : undefined,
      ),
    );
  }
  if (options.stringEnums && options.outputEncodeMethods) {
    chunks.push(code`\n`);
    chunks.push(
      generateEnumToNumber(
        ctx,
        fullName,
        enumDesc,
        unrecognizedEnum,
        useNamespace ? namespaceName : undefined,
        useNamespace ? actualEnumName : undefined,
      ),
    );
  }

  return joinCode(chunks, { on: "\n" });
}

/** Generates a function with a big switch statement to decode JSON -> our enum. */
export function generateEnumFromJson(
  ctx: Context,
  fullName: string,
  enumDesc: EnumDescriptorProto,
  unrecognizedEnum: UnrecognizedEnum,
  namespaceName?: string,
  actualEnumName?: string,
): Code {
  const { options, utils } = ctx;
  const chunks: Code[] = [];

  const enumReference = namespaceName && actualEnumName ? `${namespaceName}.${actualEnumName}` : fullName;
  const functionName = uncapitalize(fullName) + "FromJSON";
  chunks.push(code`export function ${def(functionName)}(object: any): ${enumReference} {`);
  chunks.push(code`switch (object) {`);

  for (const valueDesc of enumDesc.value) {
    const memberName = getMemberName(ctx, enumDesc, valueDesc);
    const valueName = getValueName(ctx, fullName, valueDesc);
    chunks.push(code`
      case ${valueDesc.number}:
      case "${valueName}":
        return ${enumReference}.${memberName};
    `);
  }

  if (options.unrecognizedEnum) {
    if (!unrecognizedEnum.present) {
      chunks.push(code`
        case ${options.unrecognizedEnumValue}:
        case "${options.unrecognizedEnumName}":
        default:
          return ${enumReference}.${options.unrecognizedEnumName};
      `);
    } else {
      chunks.push(code`
        default:
          return ${enumReference}.${unrecognizedEnum.name};
      `);
    }
  } else {
    // We use globalThis to avoid conflicts on protobuf types named `Error`.
    chunks.push(code`
      default:
        throw new ${utils.globalThis}.Error("Unrecognized enum value " + object + " for enum ${fullName}");
    `);
  }

  chunks.push(code`}`);
  chunks.push(code`}`);
  return joinCode(chunks, { on: "\n" });
}

/** Generates a function with a big switch statement to encode our enum -> JSON. */
export function generateEnumToJson(
  ctx: Context,
  fullName: string,
  enumDesc: EnumDescriptorProto,
  unrecognizedEnum: UnrecognizedEnum,
  namespaceName?: string,
  actualEnumName?: string,
): Code {
  const { options, utils } = ctx;

  const chunks: Code[] = [];

  const enumReference = namespaceName && actualEnumName ? `${namespaceName}.${actualEnumName}` : fullName;
  const functionName = uncapitalize(fullName) + "ToJSON";
  chunks.push(
    code`export function ${def(functionName)}(object: ${enumReference}): ${
      ctx.options.useNumericEnumForJson ? "number" : "string"
    } {`,
  );
  chunks.push(code`switch (object) {`);

  for (const valueDesc of enumDesc.value) {
    if (ctx.options.useNumericEnumForJson) {
      const memberName = getMemberName(ctx, enumDesc, valueDesc);
      chunks.push(code`case ${enumReference}.${memberName}: return ${valueDesc.number};`);
    } else {
      const memberName = getMemberName(ctx, enumDesc, valueDesc);
      const valueName = getValueName(ctx, fullName, valueDesc);
      chunks.push(code`case ${enumReference}.${memberName}: return "${valueName}";`);
    }
  }

  if (options.unrecognizedEnum) {
    if (!unrecognizedEnum.present) {
      chunks.push(code`
        case ${enumReference}.${options.unrecognizedEnumName}:`);

      if (ctx.options.useNumericEnumForJson) {
        chunks.push(code`
        default:
          return ${options.unrecognizedEnumValue};
      `);
      } else {
        chunks.push(code`
        default:
          return "${options.unrecognizedEnumName}";
      `);
      }
    } else if (ctx.options.useNumericEnumForJson) {
      chunks.push(code`
        default:
          return ${options.unrecognizedEnumValue};
      `);
    } else {
      chunks.push(code`
      default:
        return "${unrecognizedEnum.originalName}";
    `);
    }
  } else {
    // We use globalThis to avoid conflicts on protobuf types named `Error`.
    chunks.push(code`
      default:
        throw new ${utils.globalThis}.Error("Unrecognized enum value " + object + " for enum ${fullName}");
    `);
  }

  chunks.push(code`}`);
  chunks.push(code`}`);
  return joinCode(chunks, { on: "\n" });
}

/** Generates a function with a big switch statement to encode our string enum -> int value. */
export function generateEnumToNumber(
  ctx: Context,
  fullName: string,
  enumDesc: EnumDescriptorProto,
  unrecognizedEnum: UnrecognizedEnum,
  namespaceName?: string,
  actualEnumName?: string,
): Code {
  const { options, utils } = ctx;

  const chunks: Code[] = [];

  const enumReference = namespaceName && actualEnumName ? `${namespaceName}.${actualEnumName}` : fullName;
  const functionName = uncapitalize(fullName) + "ToNumber";
  chunks.push(code`export function ${def(functionName)}(object: ${enumReference}): number {`);
  chunks.push(code`switch (object) {`);
  for (const valueDesc of enumDesc.value) {
    chunks.push(code`case ${enumReference}.${getMemberName(ctx, enumDesc, valueDesc)}: return ${valueDesc.number};`);
  }

  if (options.unrecognizedEnum) {
    if (!unrecognizedEnum.present) {
      chunks.push(code`
        case ${enumReference}.${options.unrecognizedEnumName}:
        default:
          return ${options.unrecognizedEnumValue};
      `);
    } else {
      chunks.push(code`
        default:
          return ${options.unrecognizedEnumValue};
      `);
    }
  } else {
    // We use globalThis to avoid conflicts on protobuf types named `Error`.
    chunks.push(code`
      default:
        throw new ${utils.globalThis}.Error("Unrecognized enum value " + object + " for enum ${fullName}");
    `);
  }

  chunks.push(code`}`);
  chunks.push(code`}`);
  return joinCode(chunks, { on: "\n" });
}

export function getMemberName(
  ctx: Context,
  enumDesc: EnumDescriptorProto,
  valueDesc: EnumValueDescriptorProto,
): string {
  if (ctx.options.removeEnumPrefix) {
    return valueDesc.name.replace(`${camelToSnake(enumDesc.name)}_`, "");
  }
  return valueDesc.name;
}

function getValueName(ctx: Context, fullName: string, valueDesc: EnumValueDescriptorProto): string {
  return valueDesc.name;
}
