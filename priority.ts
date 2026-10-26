export type PriorityItem = {
  id: number;
  gutScore: number;
  createdAt: Date;
  status: string;
  subprefeitura: string | null;
};

// Número positivo significa que a está acima de b na fila.
export function comparePriority(a: PriorityItem, b: PriorityItem): number {
  if (a.gutScore !== b.gutScore) return a.gutScore - b.gutScore;
  const ageDifference = b.createdAt.getTime() - a.createdAt.getTime();
  if (ageDifference !== 0) return ageDifference;
  return b.id - a.id;
}

/** Seleciona k ocorrências pendentes com um min-heap de tamanho k: O(n log k), espaço O(k). */
export function topPriority(items: readonly PriorityItem[], k: number): PriorityItem[] {
  if (!Number.isInteger(k) || k < 0) throw new RangeError("k deve ser inteiro não negativo");
  if (k === 0) return [];
  const heap: PriorityItem[] = [];
  const swap = (a: number, b: number) => { [heap[a], heap[b]] = [heap[b], heap[a]]; };
  const up = (index: number) => {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (comparePriority(heap[parent], heap[index]) <= 0) break;
      swap(parent, index);
      index = parent;
    }
  };
  const down = (start: number) => {
    let index = start;
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = left + 1;
      if (left < heap.length && comparePriority(heap[left], heap[smallest]) < 0) smallest = left;
      if (right < heap.length && comparePriority(heap[right], heap[smallest]) < 0) smallest = right;
      if (smallest === index) break;
      swap(smallest, index);
      index = smallest;
    }
  };
  for (const item of items) {
    if (item.status === "concluido") continue;
    if (heap.length < k) {
      heap.push(item);
      up(heap.length - 1);
    } else if (comparePriority(item, heap[0]) > 0) {
      heap[0] = item;
      down(0);
    }
  }
  // A saída final de k itens custa O(k log k); evita ordenar toda a coleção.
  return heap.sort((a, b) => comparePriority(b, a));
}
