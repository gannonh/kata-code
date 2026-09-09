// @effect-diagnostics nodeBuiltinImport:off

import * as NodeFS from "node:fs";

export const sorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...values].sort();

export const sameStrings = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length &&
  sorted(left).every((value, index) => value === sorted(right)[index]);

export const validateConcreteText = (value: string, label: string): void => {
  if (value.trim() === "" || /(?:<[^>]+>|placeholder|TODO|\.\.\.)/i.test(value)) {
    throw new Error(`${label} contains a template or placeholder.`);
  }
};

export const decodeOrThrow = <A>(
  decode: (value: unknown) => A,
  value: unknown,
  label: string,
): A => {
  try {
    return decode(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is invalid: ${message}`, { cause: error });
  }
};

export const readJsonFile = (path: string, label: string): unknown => {
  try {
    return JSON.parse(NodeFS.readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${label}: ${message}`, { cause: error });
  }
};

export const validateUtcTimestamp = (value: string, label: string): void => {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${label} must be an ISO UTC timestamp: ${value}`);
  }
};
