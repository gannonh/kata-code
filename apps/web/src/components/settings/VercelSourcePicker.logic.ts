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
