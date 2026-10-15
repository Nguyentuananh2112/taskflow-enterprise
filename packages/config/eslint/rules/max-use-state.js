// taskflow/max-use-state (frontend.md §2.4): một function component gọi useState quá `max` lần
// ⇒ lỗi; chuyển state sang useReducer trong segment model/ của slice.

const FUNCTION_NODES = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];

const isUseState = (callee) =>
  (callee.type === 'Identifier' && callee.name === 'useState') ||
  (callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'useState');

/** @type {import('eslint').Rule.RuleModule} */
export const maxUseState = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Giới hạn số lần gọi useState trong một component.' },
    schema: [
      {
        type: 'object',
        properties: { max: { type: 'integer', minimum: 0 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooMany:
        'Component gọi useState {{count}} lần (tối đa {{max}}) — gom state vào useReducer trong model/.',
    },
  },
  create(context) {
    const max = context.options[0]?.max ?? 3;
    /** @type {{ node: import('estree').Node, count: number }[]} */
    const stack = [];

    const enter = (node) => stack.push({ node, count: 0 });
    const exit = () => {
      const frame = stack.pop();
      if (frame && frame.count > max) {
        context.report({
          node: frame.node,
          messageId: 'tooMany',
          data: { count: String(frame.count), max: String(max) },
        });
      }
    };

    const visitors = {
      CallExpression(node) {
        const frame = stack.at(-1);
        if (frame && isUseState(node.callee)) frame.count += 1;
      },
    };
    for (const type of FUNCTION_NODES) {
      visitors[type] = enter;
      visitors[`${type}:exit`] = exit;
    }
    return visitors;
  },
};
