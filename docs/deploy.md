# 怎么把它发到网上，以后又怎么更新

写给项目主人自己看的。假设你不熟 GitHub，每一步都写清楚点了哪儿。
**全文只有第一部分是一次性的；以后每次更新只用看第三部分那一条命令。**

---

## 零、先理解一件事

这个项目没有后端，说白了就是**一堆静态文件**。
`npm run build` 会把源码打包进 `dist/` 文件夹，把那个文件夹丢到任何能放网页的地方都能跑。
GitHub Pages 就是 GitHub 免费提供的"放网页的地方"。

所以整件事只有两个动作：**打包**、**把包放上去**。
下面配置的 GitHub Actions 会替你自动做这两件事——你只需要 `git push`。

---

## 一、第一次发布（只做一次）

### 1. 在 GitHub 上建一个空仓库

浏览器打开 <https://github.com/new>：

- **Repository name** 填 `game-of-life`（叫别的也行，网址里会出现这个名字）
- 选 **Public**（Pages 免费版需要公开仓库）
- **不要**勾 "Add a README file"、"Add .gitignore"、"Choose a license"——本地已经有了，勾了会撞车
- 点 **Create repository**

建好后 GitHub 会显示一段 "…or push an existing repository" 的命令，跟下面第 3 步是一回事。

### 2. 先把提交里的邮箱换掉（**必须在推之前做**）

仓库一旦公开，**每条提交记录里的作者邮箱所有人都看得到**，而且会被爬虫收集去发垃圾邮件。
这个仓库的 21 条提交里有两种身份要清：20 条是你的真实邮箱，最新那条是 git 在没配
`user.email` 时自动兜底的「用户名@主机名.local」（这个泄的是你这台机器的名字）。
`v1.0` 那个标签的 tagger 里也有一份。

**先拿到 GitHub 给你的隐私邮箱**：登录后打开 <https://github.com/settings/emails>，
勾上 **Keep my email addresses private**。那一行下面会显示一个形如
`12345678+你的用户名@users.noreply.github.com` 的地址，复制它。

**然后在项目目录里跑**（把地址换成你复制的那个）：

```bash
sh ../rewrite-email.sh '12345678+你的用户名@users.noreply.github.com' 'Leo Chen'
```

它会依次做：备份成一个 `.bundle` 文件 → 改写全部 21 条提交的作者和提交者 →
用新身份重建 `v1.0` 标签（日期保持原样）→ 清掉 `refs/original` 和 reflog 里的旧提交残留 →
把这个仓库以后的提交也配成这个邮箱 → 最后验一遍所有引用里再没有旧邮箱。
末尾打印「干净」才算成。

**这一步只改署名，不动任何内容**：21 条提交的文件树哈希、提交信息、作者日期全都逐条对过，
一模一样；改写后 `npm test` 仍是 77/77。

万一想反悔，备份文件就在仓库的上一层目录里，`git clone 那个.bundle` 就能拿回原样。
确认没问题之后可以把它删掉——**别把它推到网上**，它里面装的正是旧邮箱。

跑完之后 `../rewrite-email.sh` 这个脚本也可以删了，一次性的。

### 3. 把本地代码推上去

在项目目录里（把 `你的用户名` 换成实际的）：

```bash
git remote add origin https://github.com/你的用户名/game-of-life.git
```

```bash
git push -u origin main
```

第一次会让你登录。GitHub 现在**不接受账号密码**，会弹浏览器窗口让你授权，照着点就行。
（如果它反而要你输密码，那是要 Personal Access Token，见文末"卡住了怎么办"。）

### 4. 打开 Pages 开关

浏览器进你的仓库 → 顶部 **Settings** → 左边栏 **Pages** →
**Build and deployment** 下面的 **Source** 选 **GitHub Actions**（不是 "Deploy from a branch"）。

选完就完事了，这一页不用保存。

### 5. 等它自己跑完

进仓库顶部的 **Actions** 标签，会看到一条叫 *Deploy to GitHub Pages* 的任务在跑。
两三分钟，出现绿色对勾就是好了。

网址是：

```
https://你的用户名.github.io/game-of-life/
```

Actions 那条任务点进去，`deploy` 那一格里也会直接显示这个链接。

---

## 二、接访问统计（可选，随时能加）

想知道有多少人来看过，就做这一节；不做也完全不影响网站。

### 1. 注册 GoatCounter

1. 打开 <https://www.goatcounter.com/signup>
2. **Code** 填一个你喜欢的名字，比如 `golife`——它会变成你的后台网址 `golife.goatcounter.com`
3. 填邮箱、设密码，提交
4. 去邮箱点确认链接

你的**统计地址**就是：`https://golife.goatcounter.com/count`（把 `golife` 换成你填的那个）。

### 2. 地址配在哪（本仓库已经配好了）

**本仓库的地址已经写在 `.github/workflows/deploy.yml` 里**（D99）：

```yaml
VITE_GOATCOUNTER: ${{ vars.GOATCOUNTER || (github.repository == 'geesonchan/game-of-life' && 'https://geesonchan.goatcounter.com/count' || '') }}
```

读法是：

1. **仓库变量 `GOATCOUNTER` 优先** —— 设了就用它。改地址、换账号、临时停掉统计，
   都在 Settings 里改，不必动代码：
   仓库 → **Settings** → **Secrets and variables** → **Actions** → **Variables** 标签页 →
   **New repository variable**，Name 填 `GOATCOUNTER`，Value 填 `https://你的名字.goatcounter.com/count`。
2. 没设变量时，**只有本仓库**回落到上面那个默认地址。
   `github.repository ==` 那道判断是给 fork 的人留的：
   别人 fork 去自己部署，不该把他的访问量记到原作者后台里。

**为什么敢把地址写进仓库**：它本来就不是秘密 —— 最终会出现在发布出去的页面里，
谁都能在浏览器里看到。放变量还是放这里，差别只在"改它要不要动代码"。

### 3. 让它生效

下次 push 就自动带上了。不想等的话：**Actions** → 左边选 *Deploy to GitHub Pages* →
右边 **Run workflow** → 绿色按钮。

### 4. 看数字

登录 <https://www.goatcounter.com/>，数字只有你看得见，页面上不显示任何计数器。

**本地开发永远不统计**，两道闸门（都有测试盯着）：

1. **构建时**：本地 `npm run dev` / `npm run build` 不带 `VITE_GOATCOUNTER`，
   于是那段代码**被整段摇掉** —— 实测本地构建产物里搜不到 `goatcounter`、
   也搜不到 `gc.zgo.at`，一个字节都不剩，谈不上发请求。
2. **运行时**：即便拿正式包在本地起服务，`localhost` 与 `127.0.0.1` 也是写死排除的
   （见 [`src/analytics.js`](../src/analytics.js)）。

---

## 三、以后怎么更新（**日常只需要这一步**）

改完代码，在项目目录里：

```bash
npm test && git add -A && git commit -m "改了点啥" && git push
```

推上去之后 GitHub 自己会：跑测试 → 打包 → 发布。两三分钟后刷新网页就是新的。

**测试不过就不会发布**——这是故意的，免得把坏版本推到线上。
测试挂了的话 `git push` 之前那个 `npm test` 就先拦下来了，根本轮不到 GitHub。

看进度：仓库 **Actions** 标签。红叉就是没成，点进去能看到是哪一步、报了什么。

---

## 三点五、发布后的冒烟清单（每次发布都走一遍）

Actions 变绿只说明**构建**成功了，不说明**页面**是好的。
2026-08-29 那次就是构建全绿、测试全过，结果三幕卡点「下一幕」直接报错 —— 见 `docs/decisions.md` D65。

所以每次发布后，在**线上网址**上走五步，两分钟：

1. **三幕** —— 选版本 → 一路点「下一幕」点到底（**不是**点跳过）
2. **放图案** —— 玩具盒里挑一个，放到棋盘上
3. **跑一局** —— 点播放，看代数和存活数在动
4. **造塔** —— 进观塔模式，点「造塔」，看塔出来
5. **切语言** —— 中/EN 切一次，简洁/完整切一次
6. **窄屏按钮目检**（手机上做）—— 切成英文再看一遍：有没有按钮的文字断成两行、
   或者被容器切掉半个字。中文按钮尤其要看，中文没有空格、可以在任意两字之间断行。

第 6 步想省事的话，把这段贴进手机浏览器的控制台，它会把折行和溢出的按钮列出来
（数的是文字行盒，不是盒子高度 —— 触控用的 44px 高度会让每个按钮都像是超过一行）：

```javascript
[...document.querySelectorAll('button')].filter(el=>{if(el.classList.contains('card')||el.classList.contains('pick-card'))return false;const b=el.getBoundingClientRect();if(!b.width)return false;const r=document.createRange();r.selectNodeContents(el);return r.getClientRects().length>1||el.scrollWidth>Math.ceil(b.width)+1}).map(el=>el.textContent.trim())
```

**全程开着控制台**（Mac 上 Cmd+Option+J），红字一条都不能有。

这五步不是随手挑的：它们分别走五条互不相干的代码路径
（介绍卡 / 图案库 / 主循环 / Worker+WebGL / 多语言），
任何一条断了都不该等别人来报。而且每一步都要**真的用鼠标点**，
不是在控制台里调函数 —— 上次漏掉的恰好就是"点"这个动作本身。

---

## 四、卡住了怎么办

**推的时候要密码，输了又说不对**
GitHub 早就停用密码推送了。装个 [GitHub CLI](https://cli.github.com/)（`brew install gh`）
然后 `gh auth login`，一路回车，之后 `git push` 就不问了。

**Actions 里那条任务是红叉**
点进去看是哪一格红了：

- 红在 `npm test` → 是代码问题，本地跑一遍 `npm test` 同样能看到
- 红在 `npm ci` → 多半是 `package-lock.json` 没提交，`git add package-lock.json` 再推
- 红在 `deploy` 那一格，写着 Pages 没开 → 回第一部分第 4 步

**网页打开一片白**
按 F12 打开控制台看报错。如果全是 404 找不到 `assets/xxx.js`，
说明打包的路径设错了——这个项目用的是相对路径（`vite.config.js` 里的 `base: './'`），
仓库改名也不该出这个问题，出了就是那行被人改动过。

**改完推了，网页还是旧的**
先去 Actions 确认那条任务真的跑完并且是绿的。是绿的还看到旧页面，
就是浏览器缓存：Mac 上按 Shift + 刷新按钮，或者用无痕窗口开一次。

**想换个仓库名**
改名后网址跟着变成 `https://你的用户名.github.io/新名字/`，代码不用动
（相对路径的好处就在这儿）。

---

## 五、想搬到别处

`dist/` 是完全独立的静态文件夹，Netlify、Vercel、Cloudflare Pages、
甚至自己的服务器，把它整个丢上去就能跑，不需要任何配置。
唯一的要求是**用 http(s) 访问**，不能直接双击 `index.html` 打开——
里面用到了 Web Worker 和 ES module，`file://` 协议下浏览器会拦。

---

## 六、推完之后：核对线上到底是哪一版

**这一条是被一次真机复验逼出来的**（D92 ②）：用户在真机上验的是**上一版** ——
修好那次的提交我留在本地没推，而当时没有任何东西能一眼看出"线上是哪一版"。
两边就此对着不同的代码讨论同一个 bug，白跑一轮。

现在每次构建都会把 `package.json` 的版本号写进页面的静态 HTML，
所以核对是一条命令的事：

```bash
curl -s https://你的用户名.github.io/game-of-life/ | grep app-version
```

**规矩：交给真机复验之前，先跑这一条，确认它与本地 `package.json` 里的版本一致。**
不一致就说明 Pages 还没换上新版（构建要一两分钟），或者**这次的提交根本没推**。

顺带一提，GitHub Pages 的缓存偶尔会滞后一两分钟；
若版本号已经对上、页面行为却还像旧的，硬刷新一次（手机上是长按刷新 →「请求桌面站点」再切回，
或者在网址后面加个 `?v=2` 强制绕过缓存）。
