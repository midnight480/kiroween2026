import { COMPUTE } from "./compute.js";
import { CONTAINERS } from "./containers.js";
import { DATABASE } from "./database.js";
import { MESSAGING } from "./messaging.js";
import { NETWORK } from "./network.js";
import type { ResourceSpec } from "./spec.js";

export { emitFromSpec } from "./engine.js";
export type { Field, ListSpec, ResourceSpec } from "./spec.js";

/** 対応表の全体。リソース型 → 仕様。手書きの変換（emit.ts）を持つ型は含めない。 */
export const SPECS: ReadonlyMap<string, ResourceSpec> = new Map([...NETWORK, ...COMPUTE, ...DATABASE, ...CONTAINERS, ...MESSAGING].map((s) => [s.type, s]));
