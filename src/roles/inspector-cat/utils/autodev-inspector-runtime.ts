import { AutoDevInspectorWorker } from './autodev-inspector-worker';

let activeAutoDevInspectorWorker: AutoDevInspectorWorker | null = null;

export function setActiveAutoDevInspectorWorker(worker: AutoDevInspectorWorker | null): void {
  activeAutoDevInspectorWorker = worker;
}

export function getActiveAutoDevInspectorWorker(): AutoDevInspectorWorker | null {
  return activeAutoDevInspectorWorker;
}
