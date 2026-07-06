module.exports = {
  extends: [
    'eslint-config-ali/typescript/react',
    'plugin:eslint-plugin-import/typescript',
    'plugin:prettier/recommended',
  ],
  parserOptions: {
    project: './tsconfig.json',
  },
  overrides: [
    {
      files: ['*.axml', '**/*.axml'],
      extends: ['plugin:@alipay/paul/recommend:axml'],
      rules: {
        '@alipay/paul/text-img-wrap-limit': 'error',
        '@alipay/paul/text-interpolation-check': 'error',
        '@typescript-eslint/dot-notation': 'off',
        '@typescript-eslint/restrict-plus-operands': 'off',
        'prettier/prettier': 'off',
      },
    },
  ],
};
