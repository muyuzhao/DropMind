"use client";

import { inspectAutomationRunAction, inspectChapterAutomationRunAction } from "@/app/novels/actions";

const planningQueues = new Map<string, Promise<unknown>>();
const chapterQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(queues: Map<string, Promise<unknown>>, key: string, operation: () => Promise<T>) {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  queues.set(key, tail);
  void tail.finally(() => { if (queues.get(key) === tail) queues.delete(key); });
  return result;
}

export function inspectAutomationRunQueued(novelId: string, options: { importPaused?: boolean } = {}) {
  return enqueue(planningQueues, novelId, () => inspectAutomationRunAction(novelId, options));
}

export function inspectChapterAutomationRunQueued(novelId: string) {
  return enqueue(chapterQueues, novelId, () => inspectChapterAutomationRunAction(novelId));
}
