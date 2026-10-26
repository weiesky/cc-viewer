/** Display-only placement of confirmed queue inputs, never part of model messages. */
export function queuedPromptsAfterIndex(queuedPrompts, afterIndex) {
  return (Array.isArray(queuedPrompts) ? queuedPrompts : []).filter((prompt) => prompt.afterIndex === afterIndex);
}

/** The session cache signature must include auxiliary display records as well as
 * model messages, otherwise a newly arrived prompt keeps the previous rendered list. */
export function queuedPromptsSignature(queuedPrompts) {
  return (Array.isArray(queuedPrompts) ? queuedPrompts : [])
    .map((prompt) => `${prompt._ccvSourceId}:${prompt.afterIndex}`)
    .join('|');
}
