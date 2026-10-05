import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const deterministic = 'The engine must be deterministic (docs/SPEC.md, rule 7).';
const detmath = `${deterministic} Use kernel/detmath.ts: the built-in is not guaranteed to agree between JS engines.`;

// Math functions whose results ECMAScript leaves implementation-approximated.
const approximated = [
  'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'cbrt', 'cos', 'cosh', 'exp', 'expm1', 'hypot',
  'log', 'log10', 'log1p', 'log2', 'pow', 'sin', 'sinh', 'tan', 'tanh',
];

export default tseslint.config(
  {
    ignores: ['**/dist/', '**/node_modules/', '**/coverage/', '**/playwright-report/', '**/test-results/'],
  },
  js.configs.recommended,
  {
    // Repository scripts run on Node.js.
    files: ['scripts/**'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The kernel indexes typed arrays by number; those accesses are checked by hand.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // A leading underscore marks a parameter that a method takes for its overrides to use.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: `${deterministic} Use the simulation clock.` },
        { name: 'performance', message: `${deterministic} Use the simulation clock.` },
        { name: 'setTimeout', message: `${deterministic} Schedule an event instead.` },
        { name: 'setInterval', message: `${deterministic} Schedule an event instead.` },
        { name: 'crypto', message: `${deterministic} Use a seeded stream from kernel/rng.ts.` },
        'process',
        'Buffer',
        'window',
        'document',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: `${deterministic} Use a seeded stream from kernel/rng.ts.` },
        ...approximated.map((property) => ({ object: 'Math', property, message: detmath })),
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: detmath },
        { selector: "AssignmentExpression[operator='**=']", message: detmath },
      ],
    },
  },
);
