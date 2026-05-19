import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['node_modules', 'dist'] },
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    }
);
