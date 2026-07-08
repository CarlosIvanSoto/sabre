import eslintJs from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Configuración global
  {
    // Ignora los archivos de build y dependencias
    ignores: ["dist/**", "node_modules/**", "*.config.js", "*.config.ts"],
  },

  // Configuración base de ESLint
  eslintJs.configs.recommended,

  // Configuración específica para archivos TypeScript
  {
    // Aplica estas reglas solo a los archivos .ts
    files: ['src/**/*.ts'],
    // Extiende las configuraciones recomendadas con chequeo de tipos
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
    ],
    // Opciones del parser específicas para este grupo de archivos
    languageOptions: {
      parserOptions: {
        project: true, // Habilita reglas que necesitan información de tipos
        tsconfigRootDir: import.meta.dirname, // Directorio raíz para encontrar tsconfig.json
      },
    },
    rules: {
      // Tus reglas personalizadas
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      // Corrige el warning de "unused-vars" para el patrón `as const`
      '@typescript-eslint/no-unused-vars': ['warn', {
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_',
        'caughtErrorsIgnorePattern': '^_',
      }],
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
    }
  }
)
