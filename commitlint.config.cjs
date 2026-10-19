// Quy ước commit: Conventional Commits
// Dạng: type(scope): mô tả   ví dụ  feat(bff): them endpoint danh sach xe
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'chore', 'docs', 'test', 'refactor', 'build', 'ci', 'perf', 'style', 'revert'],
    ],
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
  },
};
