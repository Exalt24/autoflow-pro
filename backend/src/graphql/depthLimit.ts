// A validation rule that refuses a query nested deeper than `max`. Without it a client can ask for
// workflow { runs { edges { node { workflow { runs { ... } } } } } } as deep as it likes, and each level multiplies the work.
// Depth counts fields: `{ runs { edges { node { id } } } }` is depth 4. Fragments are followed; a fragment cycle is cut off
// (other rules report it) so this rule cannot loop.
import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from "graphql";

export const DEPTH_LIMIT_CODE = "DEPTH_LIMIT_EXCEEDED";

export function depthLimitRule(max: number) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const def of context.getDocument().definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
    }

    const depthOf = (set: SelectionSetNode, seen: ReadonlySet<string>): number => {
      let deepest = 0;
      for (const sel of set.selections) {
        if (sel.kind === Kind.FIELD) {
          const below = sel.selectionSet ? depthOf(sel.selectionSet, seen) : 0;
          deepest = Math.max(deepest, 1 + below);
        } else if (sel.kind === Kind.INLINE_FRAGMENT) {
          deepest = Math.max(deepest, depthOf(sel.selectionSet, seen));
        } else {
          const name = sel.name.value;
          const frag = fragments.get(name);
          if (frag && !seen.has(name)) deepest = Math.max(deepest, depthOf(frag.selectionSet, new Set(seen).add(name)));
        }
      }
      return deepest;
    };

    return {
      OperationDefinition(node) {
        const depth = depthOf(node.selectionSet, new Set());
        if (depth > max) {
          const label = node.name ? `"${node.name.value}"` : "this operation";
          context.reportError(
            new GraphQLError(`Query ${label} is ${depth} levels deep; the limit is ${max}.`, {
              nodes: [node],
              extensions: { code: DEPTH_LIMIT_CODE, depth, max },
            }),
          );
        }
      },
    };
  };
}
