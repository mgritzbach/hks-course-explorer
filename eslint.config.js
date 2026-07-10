import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactPlugin from 'eslint-plugin-react'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2020 },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-undef': 'error',
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/display-name': 'off',
      // Missing hook dependencies can retain stale data or callbacks. Keep
      // this as a hard error so future changes cannot silently reintroduce
      // the class of lifecycle bugs corrected in the corporate-readiness pass.
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    // Library modules are the dependency floor. They may be shared by pages
    // and components, but must not import UI layers back into themselves.
    files: ['src/lib/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../components/*', '../pages/*', '../App*'],
              message:
                'Library modules must not depend on UI layers; pass data in through a function or hook boundary.',
            },
          ],
        },
      ],
    },
  },
]
