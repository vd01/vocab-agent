export interface Extractor {
  name: string;
  description: string;
  extract: () => Promise<Record<string, unknown>>;
}

export interface ExtractorRegistry {
  register: (extractor: Extractor) => void;
  getAll: () => Extractor[];
  getByName: (name: string) => Extractor | undefined;
}

function createRegistry(): ExtractorRegistry {
  const extractors = new Map<string, Extractor>();

  return {
    register(extractor: Extractor) {
      extractors.set(extractor.name, extractor);
    },
    getAll() {
      return Array.from(extractors.values());
    },
    getByName(name: string) {
      return extractors.get(name);
    },
  };
}

export const extractorRegistry = createRegistry();
