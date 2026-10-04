import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

const databaseWriterRestriction = {
  regex: '(?:^|/)database(?:/.*)?$',
  importNames: ['getDatabase', 'saveDatabase', 'saveDatabaseSync'],
  message:
    'Raw database access belongs to database internals. Use repositories or named lifecycle/transaction exports.'
}

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '**/.worktrees/**',
      '**/worktrees/**',
      '**/.reports/**',
      '**/coverage/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        },
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser
      }
    }
  },
  {
    files: ['**/*.{ts,mts,tsx,vue}'],
    rules: {
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/block-lang': [
        'error',
        {
          script: {
            lang: 'ts'
          }
        }
      ]
    }
  },
  {
    files: ['src/**/*.{ts,mts,tsx,vue}'],
    ignores: ['src/main/services/database/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [databaseWriterRestriction] }]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,mts,tsx,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            databaseWriterRestriction,
            {
              regex: '^(?:@main(?:/|$)|(?:.*?/)?main(?:/|$))',
              message: 'Renderer code must use shared contracts and IPC, not main implementation.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,mts,tsx,vue}'],
    ignores: ['src/renderer/src/utils/ipc.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[object.object.name="window"]:matches([object.property.name="electron"], [object.property.value="electron"]):matches([property.name="ipcRenderer"], [property.value="ipcRenderer"])',
          message:
            'Use invokeIpc/onIpc from renderer utils/ipc instead of direct ipcRenderer access.'
        },
        {
          selector:
            'VariableDeclarator[init.object.name="window"]:matches([init.property.name="electron"], [init.property.value="electron"]) > ObjectPattern > Property:matches([key.name="ipcRenderer"], [key.value="ipcRenderer"])',
          message:
            'Use invokeIpc/onIpc from renderer utils/ipc instead of direct ipcRenderer access.'
        }
      ]
    }
  },
  eslintConfigPrettier
)
