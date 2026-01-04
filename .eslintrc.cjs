module.exports = {
    root: true,
    env: {
        browser: true,
        node: true,
        es2022: true
    },
    extends: [
        'eslint:recommended',
        '@electron-toolkit/eslint-config-ts/recommended'
    ],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    },
    rules: {
        // TypeScript 相关规则
        '@typescript-eslint/no-unused-vars': ['warn', {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_'
        }],
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/explicit-function-return-type': 'off',

        // 通用规则
        'no-console': 'off', // Electron 项目常用 console
        'prefer-const': 'warn',
        'no-unused-expressions': 'warn'
    },
    ignorePatterns: [
        'node_modules/',
        'out/',
        'dist/',
        '*.config.js',
        '*.config.ts'
    ]
}
