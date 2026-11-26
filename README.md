# codez

把 [CodeZ](https://codezsy.com) 加成 magpie 的供应商，用 API 密钥登录。

- 模型列表来自每把密钥自己的 `/v1/models`：一把密钥属于 CodeZ 的一个分组，
  只列这个分组能用的模型。多把密钥（比如 gpt 分组、国模分组、gemini 分组）
  都登录在同一个 CodeZ 供应商下，请求会发给列着这个模型的那把。
- 每个模型走哪个接口：
  - GPT、Codex、o 系列走 Responses。CodeZ 原生支持，它的模型列表里却只标了
    `openai`（Chat）；
  - Claude 走 Messages；
  - Gemini 模型：CodeZ 列表里标了 `gemini` 的，走 Gemini 原生接口
    （generateContent），发到 CodeZ 的 `/v1beta`（和 `/v1` 同一级）。Gemini CLI
    的请求按 Gemini 的格式发过去，不再经过 Chat 转换（0.4.3 起）；
  - 其他模型走 Chat completions。

  CodeZ 列表里标出的其他接口写进 `also`：客户端用那些接口发来的流式请求原样转发，
  不做翻译。插件给每个请求都带上 `Authorization: Bearer <密钥>`：magpie 按模型
  自己的接口放密钥（Gemini 模型放在 `x-goog-api-key`），而 CodeZ 的 Responses
  接口只认 `Authorization`。
- 地址：登录时选这把密钥的请求发到哪儿，每个账号各自记着。窗口里鼠标停在选项上、
  命令行里选项后面，能看到每个地址的说明：
  - `api-cfmax.codezsy.com`：Cloudflare 优选节点，线路稳定；
  - `codezsy.com`：主站域名，和网站、控制台同一个地址；
  - `api-s.codezsy.com`：多台服务器中转，不经过 Cloudflare；
  - 自定义地址：填 `/v1` 那一级，只填域名会自动补 `/v1`。

  前两个经过 Cloudflare：100 秒内还没开始回应的请求会被断开（524）。流式请求不受
  影响；不走流式又很久才出结果的请求，用 `api-s`。这几个地址后面是同一个 CodeZ，
  同一把密钥哪个都能用。插件 0.2.0 之前登录的账号没记地址，走
  `api.codezsy.com`；要换地址，在面板里改（见下）。
- 账号那一行写着这把密钥走的地址和它列出的模型，按系列数，多的在前，比如
  `api-s.codezsy.com · Claude 12 · GPT 11`，几把不同分组的密钥一眼能分开。
  CodeZ 不通过 API 公开密钥的额度（`quota_details_hidden`），所以没有用量数字，
  余额去 codezsy.com 看。
- 路由：magpie 按模型挑密钥，列表里没有这个模型的密钥排在后面，所以 GPT 发给有
  GPT 的那把、Claude 发给有 Claude 的那把。账号区写的"前一个额度用完换下一个"是
  magpie 给订阅账号的通用说明，插件改不了。

## 面板（0.5.0 起）

magpie 侧边栏「插件」组里的「CodeZ 面板」：

- 密钥：magpie 里登录的每把 CodeZ 密钥一行，写着名字、密钥末 4 位、地址、分组
  （按系列数的模型）和能不能用。点一行展开它的模型：CodeZ 说每个模型支持哪些接口，
  magpie 默认走哪个、哪些客户端请求原样转发。
- 编辑：改名字、换密钥、换地址。换了密钥或地址先向 CodeZ 要一次模型列表，CodeZ
  拒绝或连不上就不保存。名字会显示在 magpie 供应商编辑窗口的账号那一行。
- 添加、删除密钥：和 magpie 自己的「添加另一个 CodeZ 账号」「移除」一样，删除要点
  两次确认，只删 magpie 里的这把，CodeZ 上的令牌不受影响。
- 线路测速：每把密钥向每个 CodeZ 地址要两次模型列表，取快的，标出最快的地址，可以
  一键改用。不花额度。
- 模型接口测试：选一把密钥和一个模型，直接向 CodeZ（不经过 magpie）的 Chat、
  Responses、Messages、Gemini 四个接口各发一句极短的话，显示通不通、耗时和报错原文。
  会花一点额度。

改动通过 magpie 交给插件的 `client.auth.set` / `auth.remove` 写进
`plugin-auth.json`，magpie 随即重新载入这把密钥。面板的服务只听 127.0.0.1，端口默认
3589，被占用时在插件选项里改 `port`；面板只看得到密钥末 4 位。

## 安装

```sh
magpie plugin add github:zwenooo/magpie-codez
magpie plugin login codez        # 先选地址，再粘贴 API 密钥；每把密钥登录一次
```

密钥在 <https://codezsy.com/console/token>。

## 和手动加的 CodeZ 供应商并存

如果 magpie 里已经有一个 id 为 `codez` 的供应商（fork 的 CodeZ 预设，或者手动
加的中转站），插件的供应商会叫 `codez-plugin`，两者互不影响。把旧的删掉之后，
插件的供应商就叫 `codez`，模型名仍是 `codez/<模型>`，原来按这个名字挑的模型
还能对上。

## 注意

- 模型的上下文长度和价格 CodeZ 的列表里没有，插件不填（显示为未知）。
- 一个供应商超过 24 个模型、又没有挑选时，magpie 只先放出前 24 个。用
  `magpie provider models codez +<模型>` 或在供应商页里挑。

## 开发

```sh
bun test
magpie plugin add <本文件夹>
```

## 版本

从 GitHub 装（不带 `#…`）的跟着 `main`，有新提交时 magpie 提示更新；要固定某个版本，用
`github:zwenooo/magpie-codez#v<版本>`。

发布新版本：改好、提交后，把 `package.json` 的 version 提上去，提交，再
`git tag v<版本> && git push origin main v<版本>`。

npm 上的 `magpie-plugin-codez` 停在 0.2.0，不再更新：插件市场没有收录（登记 PR
magpie-community/plugins#1546 被关闭，维护者说以后会出合作方案），不在市场里 npm 包
和 GitHub 地址没有区别，而每次发 npm 都要网页登录和安全密钥批准。

这个插件原先在 [zwenooo/magpie-plugins](https://github.com/zwenooo/magpie-home)（现已改名为 magpie-home）
的 `packages/codez` 里（最后一版是 tag `codez-v0.1.0`），2026-11-25 拆成了独立仓库。
那边还有 skill 和这些插件的来龙去脉（`docs/roadmap.md`）。

## 许可

MIT
