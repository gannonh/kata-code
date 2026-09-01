export interface RequestGeneration {
  readonly begin: () => number;
  readonly isCurrent: (generation: number) => boolean;
  readonly invalidate: () => void;
}

export function createRequestGeneration(): RequestGeneration {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (generation) => generation === current,
    invalidate: () => {
      current += 1;
    },
  };
}

export function appendUniqueBy<A>(
  current: ReadonlyArray<A>,
  next: ReadonlyArray<A>,
  key: (value: A) => string,
): ReadonlyArray<A> {
  const keys = new Set(current.map(key));
  const unique = [...current];
  for (const value of next) {
    const valueKey = key(value);
    if (keys.has(valueKey)) continue;
    keys.add(valueKey);
    unique.push(value);
  }
  return unique;
}

export function filterByQuery<A>(
  values: ReadonlyArray<A>,
  query: string,
  text: (value: A) => string = String,
): ReadonlyArray<A> {
  const normalized = query.trim().toLowerCase();
  return normalized.length === 0
    ? values
    : values.filter((value) => text(value).toLowerCase().includes(normalized));
}
