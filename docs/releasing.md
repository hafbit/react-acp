# 版本发布与 npm/JSR OIDC

发布仓库是公开的 `hafbit/react-acp`，默认分支为 `latest`。版本 tag 本身就是不可逆发布授权，不设置额外 Environment 审批。

## 版本与 dist-tag

| Git tag          | npm version     | npm dist-tag | JSR version     | GitHub Release |
| ---------------- | --------------- | ------------ | --------------- | -------------- |
| `v1.2.3`         | `1.2.3`         | `latest`     | `1.2.3`         | 正式版         |
| `v1.2.3-alpha.0` | `1.2.3-alpha.0` | `alpha`      | `1.2.3-alpha.0` | prerelease     |
| `v1.2.3-beta.0`  | `1.2.3-beta.0`  | `beta`       | `1.2.3-beta.0`  | prerelease     |
| `v1.2.3-rc.0`    | `1.2.3-rc.0`    | `rc`         | `1.2.3-rc.0`    | prerelease     |

其他 prerelease 格式会被 `release:check` 拒绝。发布 tag 必须是 annotated tag，且目标提交必须属于 `origin/latest`。JSR 没有 npm dist-tag 的对应概念，预发布版本通过完整 SemVer 获取。

## 首次发布 0.1.0

`@hafbit/react-acp` 首次出现于 npm registry 前无法绑定 package 级 Trusted Publisher，因此只对首版执行一次人工 bootstrap：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm release:pack
npm login
npm publish ./release-artifacts/hafbit-react-acp-0.1.0.tgz --access public --tag latest
```

`npm login` 和首次 publish 必须由包所有者完成 2FA。发布后先验证：

```bash
npm view @hafbit/react-acp@0.1.0 version
npm view @hafbit/react-acp dist-tags.latest
```

随后进入 npm package settings，配置：

- Trusted Publisher：GitHub Actions
- Organization：`hafbit`
- Repository：`react-acp`
- Workflow filename：`publish.yml`
- Environment：留空
- Allowed action：`npm publish`

保存 Trusted Publisher 后，将 Publishing access 设置为“Require two-factor authentication and disallow tokens”，并撤销不再使用的 automation token。仓库不保存 `NPM_TOKEN`。

最后创建并推送首版 tag；workflow 会验证已存在的 npm 版本并创建 GitHub Release：

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin refs/tags/v0.1.0
```

人工 bootstrap 的 0.1.0 不包含 GitHub OIDC provenance；后续由 Trusted Publishing 发布的公开版本会自动生成 provenance。

## JSR 配置与 0.1.0 补发

JSR package `@hafbit/react-acp` 必须关联 GitHub 仓库 `hafbit/react-acp`。JSR 发布使用 GitHub Actions OIDC，不设置 API token。`jsr.json` 发布 TypeScript 源码，且 `.`, `./core`, `./primitives` 必须与 npm 的公开入口保持一致。

合入 JSR 配置后，从 `latest` 手动运行一次补发模式：

```bash
gh workflow run publish.yml \
  --ref latest \
  -f version=0.1.0 \
  -f source_ref=latest
```

这是唯一允许从 `latest` 而不是匹配 tag 发布 JSR 的历史例外。workflow 要求 checkout 正好位于 `origin/latest` 顶端、两个 manifest 都是 `0.1.0`，并确认 npm 已存在精确版本。补发不会重新发布 npm、移动 `v0.1.0` 或修改已有 GitHub Release。

## 后续版本

```bash
git switch latest
git pull --ff-only
git switch -c release/v0.2.0
pnpm release:version 0.2.0
git add package.json jsr.json
git commit -m "release: v0.2.0"
git push -u origin release/v0.2.0
gh pr create --base latest --fill
```

等待 PR 的 CI 成功并合入 `latest`，更新本地分支，再创建 annotated tag：

```bash
git switch latest
git pull --ff-only
git tag -a v0.2.0 -m "v0.2.0"
git push origin refs/tags/v0.2.0
```

`.github/workflows/publish.yml` 会重新验证、打包、上传 Actions artifact、通过 OIDC 发布并验证 npm，然后发布并验证 JSR。两个 registry 的全新安装 smoke 都通过后，才创建附带 npm tarball 的 GitHub Release。

若 npm 已成功但 JSR 阶段失败，可重跑原 tag workflow。npm 状态一致时会被幂等跳过，再继续发布 JSR。也可以使用永久修复入口；除 0.1.0 特例外，源码 ref 必须是同版本 annotated tag：

```bash
gh workflow run publish.yml \
  --ref latest \
  -f version=0.2.0 \
  -f source_ref=v0.2.0
```

## 失败语义

- tag 与 `package.json.version` 不一致、不是 annotated tag或不属于 `latest`：发布前失败。
- `package.json` 与 `jsr.json` 的名称、版本或 exports 不一致：发布前失败。
- npm 版本已存在但目标 dist-tag 不一致：失败，不自动改写 registry 状态。
- npm publish 后 registry 或 fresh install 验证失败：不执行 JSR，也不创建 GitHub Release。
- JSR publish、registry 或 fresh install 验证失败：保留已发布的 npm 版本，但不创建 GitHub Release；修复后幂等重跑。
- 已存在且状态一致的 npm、JSR 版本或 GitHub Release：验证后跳过，允许 workflow 安全重跑。
