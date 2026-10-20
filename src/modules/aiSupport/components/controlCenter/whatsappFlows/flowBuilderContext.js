import { createContext } from "react";

// What a canvas node needs from the builder: copy/delete actions, publish problems, lock state.
export const FlowBuilderContext = createContext({ onCopy: () => {}, onDelete: () => {}, nodeErrors: {}, locked: false });

export default FlowBuilderContext;
