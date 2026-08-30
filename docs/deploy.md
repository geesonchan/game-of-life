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

### 2. 先决定署名用哪个邮箱（**建议在推之前处理**）

仓库一旦公开，**每条提交记录里的作者邮箱所有人都看得到**，而且会被爬虫收集去发垃圾邮件。
目前这 19 条提交署的是你的真实邮箱。三个选择：

- **A. 不管它。** 邮箱本来就不算秘密，接受就行。
- **B. 以后的提交换成 GitHub 的隐私邮箱**（历史保持原样）。
  先去 <https://github.com/settings/emails> 勾上 *Keep my email addresses private*，
  那一页会显示一个形如 `12345678+用户名@users.noreply.github.com` 的地址，然后在项目目录里跑：

  ```bash
  git config user.email 12345678+你的用户名@users.noreply.github.com
  ```

- **C. 把已有历史全部改写成隐私邮箱。** 干净，但会重写全部 19 条提交的哈希。
  这个仓库还没推给任何人，现在做代价最小。要做的话告诉我，我给你具体命令。

**选好了再往下走**，推上去之后再改就晚了（旧邮箱仍然留在别人已经克隆的副本里）。

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

### 2. 告诉 GitHub 这个地址

仓库 → **Settings** → 左边栏 **Secrets and variables** → **Actions** →
切到 **Variables** 标签页（不是 Secrets）→ **New repository variable**：

- **Name** 填 `GOATCOUNTER`
- **Value** 填 `https://golife.goatcounter.com/count`
- 点 Add variable

### 3. 让它生效

下次 push 就自动带上了。不想等的话：**Actions** → 左边选 *Deploy to GitHub Pages* →
右边 **Run workflow** → 绿色按钮。

### 4. 看数字

登录 <https://www.goatcounter.com/>，数字只有你看得见，页面上不显示任何计数器。
没配这个变量的话，页面根本不会加载统计脚本——**本地开发时永远不统计**，
`localhost` 是写死排除的（见 [`src/analytics.js`](../src/analytics.js)）。

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
