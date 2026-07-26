/**
 * Prettier Configuration for Paper Reading Assistant
 *
 * Consistent formatting across both frontend (IIFE) and backend (ESM) code.
 */

module.exports = {
  // General
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'es5',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'avoid',
  endOfLine: 'lf',

  // JavaScript specific
  parser: 'babel',

  // Override for specific file types
  overrides: [
    {
      files: ['*.json', '*.jsonc'],
      options: {
        printWidth: 120,
        tabWidth: 2,
      },
    },
    {
      files: ['*.md', '*.markdown'],
      options: {
        printWidth: 100,
        tabWidth: 2,
        proseWrap: 'preserve',
      },
    },
    {
      files: ['*.css'],
      options: {
        printWidth: 120,
        tabWidth: 2,
      },
    },
    {
      files: ['*.html'],
      options: {
        printWidth: 120,
        tabWidth: 2,
        htmlWhitespaceSensitivity: 'css',
      },
    },
  ],

  // Ignore patterns
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '.git/',
    '*.zip',
    'html_pdf2md/markitdown/',
    'backend/node_modules/',
  ],
};
