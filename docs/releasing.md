# 版本发布与 npm OIDC

发布仓库是公开的 `hafbit/react-acp`，默认分支为 `latest`。版本 tag 本身就是不可逆发布授权，不设置额外 Environment 审批。

## 版本与 dist-tag

| Git tag | npm version | npm dist-tag | GitHub Release |
| --- | --- | --- | --- |
| `v1.2.3` | `1.2.3` | `latest` | 正式版 |
| `v1.2.3-alpha.0` | `1.2.3-alpha.0` | `alpha` | prerelease |
| `v1.2.3-beta.0` | `1.2.3-beta.0` | `beta` | prerelease |
| `v1.2.3-rc.0` | `1.2.3-rc.0` | `rc` | prerelease |

其他 prerelease 格式会被 `release:check` 拒绝。发布 tag 必须是 annotated tag，且目标提交必须属于 `origin/latest`。

## 首次发布 0.1.0

`react-acp` 首次出现于 npm registry 前无法绑定 package 级 Trusted Publisher，因此只对首版执行一次人工 bootstrap：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm release:pack
npm login
npm publish release-artifacts/react-acp-0.1.0.tgz --access public --tag latest
```

`npm login` 和首次 publish 必须由包所有者完成 2FA。发布后先验证：

```bash
npm view react-acp@0.1.0 version
npm view react-acp dist-tags.latest
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

## 后续版本

```bash
git switch latest
git pull --ff-only
git switch -c release/v0.2.0
pnpm release:version 0.2.0
git add package.json
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

`.github/workflows/publish.yml` 会重新验证、打包、上传 Actions artifact、通过 OIDC 发布 npm、轮询 registry、执行全新安装 smoke，并在最后创建附带同一 tarball 的 GitHub Release。

## 失败语义

- tag 与 `package.json.version` 不一致、不是 annotated tag或不属于 `latest`：发布前失败。
- npm 版本已存在但目标 dist-tag 不一致：失败，不自动改写 registry 状态。
- npm publish 后 registry、fresh install 或 GitHub Release 验证失败：保留已发布版本并明确失败；npm 版本不可覆盖，修复后只能幂等重跑或发布新版本。
- 已存在且状态一致的 npm 版本或 GitHub Release：验证后跳过，允许 workflow 安全重跑。
