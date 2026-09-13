import type { DiagramDocument } from '@draw/renderer';
export const sampleDocument: DiagramDocument = {
  version: 2,
  title: 'A place to think',
  nodes: [
    { id: 'client', kind: 'rectangle', label: 'Start here\nA simple idea', x: 5, y: 13, width: 22, height: 6 },
    { id: 'gateway', kind: 'rectangle', label: 'Ask a question\nExplore possibilities', x: 38, y: 13, width: 24, height: 6 },
    { id: 'auth', kind: 'rectangle', label: 'Make room\nfor a new thought', x: 38, y: 1, width: 24, height: 6 },
    { id: 'queue', kind: 'rectangle', border: 'dashed', label: 'Try something\nFollow your curiosity', x: 74, y: 13, width: 24, height: 6 },
    { id: 'database', kind: 'rectangle', border: 'double', label: 'Keep the useful\nLeave room to change', x: 38, y: 29, width: 24, height: 6 },
    { id: 'worker', kind: 'rectangle', label: 'Make it yours\nDraw · write · connect', x: 74, y: 29, width: 24, height: 6 },
    { id: 'note', kind: 'text', label: 'A PLACE TO THINK', x: 5, y: 1, width: 29, height: 2 },
  ],
  edges: [
    { id: 'e1', from: 'client', to: 'gateway', label: 'begin' },
    { id: 'e2', from: 'gateway', to: 'auth', label: 'wonder' },
    { id: 'e3', from: 'gateway', to: 'queue', label: 'explore' },
    { id: 'e4', from: 'gateway', to: 'database', label: 'reflect' },
    { id: 'e5', from: 'queue', to: 'worker', label: 'create' },
    { id: 'e6', from: 'worker', to: 'database', label: 'learn' },
  ],
};
