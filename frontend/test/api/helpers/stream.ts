// frontend/test/api/helpers/stream.ts

// Fabrique un faux flux réseau à partir de morceaux que tu choisis.
export function streamFromChunks(chunks: (string | Uint8Array)[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      }
      controller.close();
    },
  });
}

// Lit un générateur jusqu'au bout et rend tous ses événements dans un tableau.
export async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}